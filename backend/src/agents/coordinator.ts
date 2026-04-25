/**
 * Coordinator agent.
 *
 * Responsibilities:
 *  1. Runs its own AXL node (port 9002 by default), joins the mesh.
 *  2. Exposes an HTTP API for the frontend:
 *       POST /task { question, workflow }  → starts a task
 *       GET  /status                       → current node registry
 *  3. Exposes a WebSocket at /ws for live UI updates.
 *  4. For each task, dispatches subtasks to research → verify → analyst
 *     over AXL, awaits each reply, emits WS events as they land.
 *
 * All agent-to-agent traffic goes through AXL /send + /recv. We do not
 * proxy through any HTTP server — coord's own AXL node is the mesh
 * entry point for other workers' replies.
 */

import http from "node:http";
import { AxlClient, pollRecv } from "../axl/client.js";
import {
  registerSelf,
  waitForAllPeers,
  lookupPubkey,
  type PeerRegistry,
} from "../axl/registry.js";
import type {
  DispatchPayload,
  NodeId,
  PeerlaneMessage,
  ReturnPayload,
  WsEvent,
} from "../types/messages.js";
import { WsHub } from "../ws/hub.js";

const REGISTRY_PATH = process.env.PEERLANE_REGISTRY_PATH ?? "./mesh-registry.json";
const AXL_API_PORT = Number(process.env.AXL_API_PORT ?? 9002);
const HTTP_PORT = Number(process.env.COORD_HTTP_PORT ?? 8080);

function log(...args: unknown[]) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [coord]`, ...args);
}

// In-memory task store. Each task has one or more outstanding RPCs.
interface PendingReturn {
  taskId: string;
  fromRole: Exclude<NodeId, "coord">;
  resolve: (payload: ReturnPayload) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
}

class Coordinator {
  private axl: AxlClient;
  private registry: PeerRegistry = { peers: {} };
  private pending = new Map<string, PendingReturn>();  // key: `${taskId}:${role}`
  private hub: WsHub;

  constructor(axl: AxlClient, hub: WsHub) {
    this.axl = axl;
    this.hub = hub;
  }

  async start(): Promise<void> {
    const myPubkey = await waitForAxlReady(this.axl);
    log("AXL ready, pubkey =", short(myPubkey));

    await registerSelf(REGISTRY_PATH, "coord", myPubkey, AXL_API_PORT);
    log("registered in peer registry");

    this.registry = await waitForAllPeers(REGISTRY_PATH);
    log("all peers online:",
      Object.entries(this.registry.peers)
        .map(([r, v]) => `${r}=${short(v!.pubkey)}`)
        .join(" "));

    // Start the inbound AXL message loop.
    const abort = new AbortController();
    process.on("SIGINT", () => abort.abort());
    process.on("SIGTERM", () => abort.abort());

    pollRecv(
      this.axl,
      (from, msg) => this.onInbound(from, msg),
      (err) => log("recv error:", err.message),
      abort.signal,
    ).catch((err) => log("recv loop crashed:", err));

    // Publish initial topology to WS subscribers on connect.
    this.hub.setGreeting(() => this.makeTopologyEvent());
  }

  private makeTopologyEvent(): WsEvent {
    return {
      kind: "topology",
      nodes: (["coord", "research", "verify", "analyst"] as NodeId[]).map((id) => ({
        id,
        pubkey: this.registry.peers[id]?.pubkey ?? "",
        online: !!this.registry.peers[id],
      })),
    };
  }

  private onInbound(from: string, msg: PeerlaneMessage): void {
    if (msg.to !== "coord") return;
    log(`inbound ${msg.type} from=${msg.from} task=${msg.taskId}`);
    this.hub.broadcast({ kind: "message", message: msg });

    if (msg.type === "RETURN" || msg.type === "ERROR") {
      const key = `${msg.taskId}:${msg.from}`;
      const pending = this.pending.get(key);
      if (!pending) {
        log("no pending promise for", key);
        return;
      }
      clearTimeout(pending.timeout);
      this.pending.delete(key);
      if (msg.type === "ERROR") {
        pending.reject(new Error((msg.payload as ReturnPayload).error ?? "worker error"));
      } else {
        pending.resolve(msg.payload as ReturnPayload);
      }
    }
  }

  /** Dispatch a subtask over AXL and await the reply. */
  private async dispatch(
    taskId: string,
    to: Exclude<NodeId, "coord">,
    verb: string,
    payload: DispatchPayload,
    timeoutMs = 60_000,
  ): Promise<ReturnPayload> {
    const peerPubkey = lookupPubkey(this.registry, to);
    const msg: PeerlaneMessage = {
      v: 1,
      mid: crypto.randomUUID(),
      taskId,
      from: "coord",
      to,
      type: "DISPATCH",
      verb,
      payload,
      ts: new Date().toISOString(),
    };

    log(`DISPATCH task=${taskId} to=${to} verb="${verb}"`);
    this.hub.broadcast({ kind: "message", message: msg });
    this.hub.broadcast({ kind: "node_busy", node: to, busy: true, ts: msg.ts });

    const key = `${taskId}:${to}`;
    const replyPromise = new Promise<ReturnPayload>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`Timeout waiting for ${to}`));
      }, timeoutMs);
      this.pending.set(key, { taskId, fromRole: to, resolve, reject, timeout });
    });
    replyPromise.catch(() => undefined);

    try {
      await this.axl.send(peerPubkey, msg);
      const result = await replyPromise;
      return result;
    } catch (err) {
      const pending = this.pending.get(key);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pending.delete(key);
      }
      throw err;
    } finally {
      this.hub.broadcast({ kind: "node_busy", node: to, busy: false, ts: new Date().toISOString() });
    }
  }

  /**
   * Run the research-brief workflow end-to-end.
   * Emits step_update events for the UI timeline.
   *
   * The pipeline:
   *   research is dispatched first (it only needs the question).
   *   verify is dispatched after research returns (it needs findings to check).
   *   analyst is dispatched after both (it synthesizes the verified result).
   *
   * Steps 1 (coord→research) and 2 (coord→verify) both show "dispatch"
   * in the UI even though the second happens later — this matches how the
   * user reads the UI: "coord sends things out, workers reply".
   */
  async runResearchBrief(question: string): Promise<{ taskId: string; result: string }> {
    const taskId = crypto.randomUUID().slice(0, 8);
    const ts = () => new Date().toISOString();

    this.hub.broadcast({ kind: "task_started", taskId, question, ts: ts() });

    // Step indices match the frontend pipeline definition:
    // 0 user→coord, 1 coord→research, 2 coord→verify, 3 research→coord,
    // 4 verify→coord, 5 coord→analyst, 6 analyst→coord, 7 coord→user
    const stepUpdate = (stepIndex: number, state: "wait" | "run" | "ok" | "err", msg?: string) =>
      this.hub.broadcast({ kind: "step_update", taskId, stepIndex, state, msg, ts: ts() });

    stepUpdate(0, "ok");

    // Step 1: coord → research.
    stepUpdate(1, "run");
    let researchResult: ReturnPayload;
    try {
      researchResult = await this.dispatch(taskId, "research", "gather_sources", { question });
      stepUpdate(1, "ok");
      stepUpdate(3, "ok", researchResult.text);
      this.hub.broadcast({ kind: "contribution", taskId, node: "research", text: researchResult.text, ts: ts() });
    } catch (e) {
      stepUpdate(1, "err", (e as Error).message);
      stepUpdate(3, "err", (e as Error).message);
      this.hub.broadcast({ kind: "task_error", taskId, error: (e as Error).message, ts: ts() });
      throw e;
    }

    // Step 2: coord → verify (with research findings attached).
    stepUpdate(2, "run");
    let verifyResult: ReturnPayload;
    try {
      verifyResult = await this.dispatch(taskId, "verify", "cross_reference", {
        question,
        priorFindings: { research: researchResult.text } as Record<NodeId, string>,
      });
      stepUpdate(2, "ok");
      stepUpdate(4, "ok", verifyResult.text);
      this.hub.broadcast({ kind: "contribution", taskId, node: "verify", text: verifyResult.text, ts: ts() });
    } catch (e) {
      stepUpdate(2, "err", (e as Error).message);
      stepUpdate(4, "err", (e as Error).message);
      this.hub.broadcast({ kind: "task_error", taskId, error: (e as Error).message, ts: ts() });
      throw e;
    }

    // Analyst synthesis.
    stepUpdate(5, "run");
    let analystResult: ReturnPayload;
    try {
      analystResult = await this.dispatch(taskId, "analyst", "synthesize", {
        question,
        priorFindings: {
          research: researchResult.text,
          verify: verifyResult.text,
        } as Record<NodeId, string>,
      });
      stepUpdate(5, "ok");
      stepUpdate(6, "ok", analystResult.text);
      this.hub.broadcast({ kind: "contribution", taskId, node: "analyst", text: analystResult.text, ts: ts() });
    } catch (e) {
      stepUpdate(5, "err", (e as Error).message);
      stepUpdate(6, "err", (e as Error).message);
      this.hub.broadcast({ kind: "task_error", taskId, error: (e as Error).message, ts: ts() });
      throw e;
    }

    // Deliver.
    stepUpdate(7, "ok");
    const confidence = extractConfidence(verifyResult.text) ?? 0.85;
    this.hub.broadcast({ kind: "task_complete", taskId, result: analystResult.text, confidence, ts: ts() });

    return { taskId, result: analystResult.text };
  }
}

/** Naive scan for a confidence score in the verifier's free text. */
function extractConfidence(text: string): number | null {
  const m = text.match(/(?:confidence|score)[^\d]{0,10}(0?\.\d{1,3})/i);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
}

async function waitForAxlReady(axl: AxlClient, timeoutMs = 30_000): Promise<string> {
  const start = Date.now();
  let lastErr: Error | null = null;
  while (Date.now() - start < timeoutMs) {
    try { return await axl.publicKey(); }
    catch (err) { lastErr = err as Error; await new Promise((r) => setTimeout(r, 500)); }
  }
  throw new Error(`AXL bridge did not become ready: ${lastErr?.message}`);
}

function short(pk: string): string { return pk.length > 10 ? pk.slice(0, 8) + "…" : pk; }

// ────────── HTTP + WS server ──────────

async function main() {
  const axl = new AxlClient(AXL_API_PORT);
  const hub = new WsHub();
  const coord = new Coordinator(axl, hub);
  await coord.start();

  const server = http.createServer(async (req, res) => {
    // Minimal permissive CORS so the Vite dev server can talk to us.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    if (req.method === "POST" && req.url === "/task") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try {
          const parsed = JSON.parse(body) as { question: string };
          if (!parsed.question?.trim()) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "question is required" }));
            return;
          }
          // Don't await — run async and let WS updates drive the UI.
          coord.runResearchBrief(parsed.question.trim())
            .catch((err) => log("task failed:", err.message));
          res.writeHead(202, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ accepted: true }));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });
      return;
    }

    if (req.method === "GET" && req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404); res.end();
  });

  hub.attach(server);

  server.listen(HTTP_PORT, () => log(`HTTP+WS listening on :${HTTP_PORT}`));
}

main().catch((err) => {
  console.error("[coord] fatal:", err);
  process.exit(1);
});
