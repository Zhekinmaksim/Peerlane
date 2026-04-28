/**
 * Coordinator agent.
 *
 * Responsibilities:
 *  1. Runs its own AXL node (port 9002 by default), joins the mesh.
 *  2. Exposes an HTTP API for the frontend:
 *       POST /task { question, workflow }  → starts a task
 *       GET  /status                       → current node registry
 *  3. Exposes a WebSocket at /ws for live UI updates.
 *  4. For each task, dispatches one chained route to research. Workers then
 *     hand off directly: research → verify → analyst → coord.
 *
 * All agent-to-agent traffic goes through AXL /send + /recv. We do not
 * proxy through any HTTP server — coord's own AXL node is the mesh
 * entry point for other workers' replies.
 */

import http from "node:http";
import { AxlClient, pollRecv } from "../axl/client.js";
import { buildCryptoSourceContext } from "../context/sources.js";
import {
  registerSelf,
  waitForAllPeers,
  lookupPubkey,
  findPeerByCapability,
  type PeerRegistry,
} from "../axl/registry.js";
import { attachProtocol, capabilitiesFor, makeAgentCard } from "../axl/protocols.js";
import type {
  CapabilityId,
  ChainHop,
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

    await registerSelf(REGISTRY_PATH, "coord", myPubkey, AXL_API_PORT, {
      capabilities: capabilitiesFor("coord"),
      agentCard: makeAgentCard("coord", myPubkey, AXL_API_PORT),
    });
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
        capabilities: this.registry.peers[id]?.capabilities ?? [],
        agentCard: this.registry.peers[id]?.agentCard,
      })),
    };
  }

  private onInbound(from: string, msg: PeerlaneMessage): void {
    if (msg.to !== "coord") return;
    log(`inbound ${msg.type} from=${msg.from} task=${msg.taskId}`);
    this.hub.broadcast({ kind: "message", message: msg });

    if (msg.type === "GOSSIP") {
      this.handleGossipProgress(msg);
    }

    if (msg.type === "RETURN" || msg.type === "ERROR") {
      const key = `${msg.taskId}:${msg.from}`;
      const pending = this.pending.get(key);
      if (!pending) {
        const fallback = Array.from(this.pending.entries())
          .find(([, p]) => p.taskId === msg.taskId);
        if (!fallback) {
          log("no pending promise for", key);
          return;
        }
        const [fallbackKey, fallbackPending] = fallback;
        log(`fallback pending ${fallbackKey} resolved by ${msg.from}`);
        clearTimeout(fallbackPending.timeout);
        this.pending.delete(fallbackKey);
        if (msg.type === "ERROR") {
          fallbackPending.reject(new Error((msg.payload as ReturnPayload).error ?? "worker error"));
        } else {
          fallbackPending.resolve(msg.payload as ReturnPayload);
        }
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

  private emitStepUpdate(
    taskId: string,
    stepIndex: number,
    state: "wait" | "run" | "ok" | "err",
    msg?: string,
  ): void {
    this.hub.broadcast({
      kind: "step_update",
      taskId,
      stepIndex,
      state,
      msg,
      ts: new Date().toISOString(),
    });
  }

  private handleGossipProgress(msg: PeerlaneMessage): void {
    const summary = payloadText(msg.payload);
    if (msg.from === "research") {
      this.emitStepUpdate(msg.taskId, 1, "ok", "research produced findings");
      this.emitStepUpdate(msg.taskId, 2, "run", summary || "research handed off to verify");
      return;
    }
    if (msg.from === "verify") {
      this.emitStepUpdate(msg.taskId, 2, "ok", "verify received research findings");
      this.emitStepUpdate(msg.taskId, 3, "run", summary || "verify handed off to analyst");
      return;
    }
    if (msg.from === "analyst") {
      this.emitStepUpdate(msg.taskId, 3, "ok", "analyst received verified claims");
      this.emitStepUpdate(msg.taskId, 4, "run", summary || "analyst returning synthesis");
    }
  }

  /** Dispatch an AXL message and await the expected final peer reply. */
  private async dispatch(
    taskId: string,
    to: Exclude<NodeId, "coord">,
    verb: string,
    payload: DispatchPayload,
    awaitFrom: Exclude<NodeId, "coord"> = to,
    timeoutMs = 60_000,
  ): Promise<ReturnPayload> {
    const peerPubkey = lookupPubkey(this.registry, to);
    const mid = crypto.randomUUID();
    const msg = attachProtocol({
      v: 1,
      mid,
      taskId,
      from: "coord",
      to,
      type: "DISPATCH",
      verb,
      payload,
      ts: new Date().toISOString(),
    }, payload.capability ?? "task.entrypoint", payload.question);

    log(`DISPATCH task=${taskId} to=${to} capability="${payload.capability ?? "task.entrypoint"}" verb="${verb}"`);
    this.hub.broadcast({ kind: "message", message: msg });
    this.hub.broadcast({ kind: "node_busy", node: to, busy: true, ts: msg.ts });

    const key = `${taskId}:${awaitFrom}`;
    const replyPromise = new Promise<ReturnPayload>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`Timeout waiting for ${awaitFrom}`));
      }, timeoutMs);
      this.pending.set(key, { taskId, fromRole: to, resolve, reject, timeout });
    });
    replyPromise.catch(() => undefined);

    try {
      await sendWithRetry(this.axl, peerPubkey, msg, (attempt, err) => {
        log(`RETRY dispatch to=${to} attempt=${attempt}:`, err.message);
      });
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
   *   coord dispatches once to research with an embedded route.
   *   research forwards directly to verify over AXL.
   *   verify forwards directly to analyst over AXL.
   *   analyst returns the final result to coord.
   */
  async runResearchBrief(question: string): Promise<{ taskId: string; result: string }> {
    const taskId = crypto.randomUUID().slice(0, 8);
    const route = this.planRoute();
    const sourceContext = await buildCryptoSourceContext(question);

    this.hub.broadcast({ kind: "task_started", taskId, question, ts: new Date().toISOString() });

    // Step indices match the frontend pipeline definition:
    // 0 user→coord, 1 coord→research, 2 research→verify,
    // 3 verify→analyst, 4 analyst→coord, 5 coord→user
    this.emitStepUpdate(taskId, 0, "ok");

    // Coord only starts the chain. The workers own every following handoff.
    this.emitStepUpdate(taskId, 1, "run");
    let analystResult: ReturnPayload;
    try {
      const [firstHop, ...remainingRoute] = route;
      await this.probeNativeA2A(taskId, firstHop.node);
      analystResult = await this.dispatch(taskId, firstHop.node, firstHop.verb, {
        question,
        capability: firstHop.capability,
        context: sourceContext.summary,
        route: remainingRoute,
      }, route[route.length - 1].node);

      for (const entry of analystResult.trace ?? []) {
        if (entry.from === "coord") continue;
        const message = {
          v: 1,
          mid: entry.mid,
          taskId,
          from: entry.from,
          to: entry.to,
          type: entry.type,
          verb: entry.verb,
          payload: {},
          ts: entry.ts,
        } satisfies PeerlaneMessage;
        this.hub.broadcast({
          kind: "message",
          message: entry.capability ? attachProtocol(message, entry.capability, entry.verb, entry.mcpTool) : message,
        });
      }

      const contributions = analystResult.contributions ?? {};
      this.emitStepUpdate(taskId, 1, "ok");
      this.emitStepUpdate(taskId, 2, "ok", contributions.research);
      this.emitStepUpdate(taskId, 3, "ok", contributions.verify);
      this.emitStepUpdate(taskId, 4, "ok", analystResult.text);

      for (const node of ["research", "verify", "analyst"] as const) {
        const text = node === "analyst" ? analystResult.text : contributions[node];
        if (text) this.hub.broadcast({ kind: "contribution", taskId, node, text, ts: new Date().toISOString() });
      }

      this.emitStepUpdate(taskId, 5, "ok");
      const confidence = extractConfidence(contributions.verify ?? analystResult.text) ?? 0.85;
      this.hub.broadcast({ kind: "task_complete", taskId, result: analystResult.text, confidence, ts: new Date().toISOString() });
    } catch (e) {
      this.emitStepUpdate(taskId, 1, "err", (e as Error).message);
      this.hub.broadcast({ kind: "task_error", taskId, error: (e as Error).message, ts: new Date().toISOString() });
      throw e;
    }

    return { taskId, result: analystResult.text };
  }

  private planRoute(): ChainHop[] {
    const plan: Array<{ capability: CapabilityId; verb: string }> = [
      { capability: "research.market", verb: "gather_sources" },
      { capability: "verify.claims", verb: "cross_reference" },
      { capability: "analyst.synthesize", verb: "synthesize" },
    ];

    const route = plan.map((hop) => ({
      ...hop,
      node: findPeerByCapability(this.registry, hop.capability),
    }));
    log("dynamic route selected:",
      route.map((hop) => `${hop.node}:${hop.capability}`).join(" -> "));
    return route;
  }

  private async probeNativeA2A(taskId: string, to: Exclude<NodeId, "coord">): Promise<void> {
    const peerPubkey = lookupPubkey(this.registry, to);
    const request = {
      jsonrpc: "2.0",
      method: "message/send",
      id: `native-a2a-${taskId}`,
      params: {
        message: {
          role: "user",
          parts: [{
            kind: "text",
            text: JSON.stringify({
              service: "peerlane",
              request: {
                jsonrpc: "2.0",
                method: "tools/list",
                id: 1,
                params: {},
              },
            }),
          }],
          messageId: `native-a2a-${taskId}`,
        },
      },
    };

    const emitProbeTrace = (ok: boolean, error?: string) => {
      const ts = new Date().toISOString();
      this.hub.broadcast({
        kind: "message",
        message: attachProtocol({
          v: 1,
          mid: crypto.randomUUID(),
          taskId,
          from: "coord",
          to,
          type: "ACK",
          verb: "native_a2a_probe",
          payload: { ok, error },
          ts,
        }, "task.entrypoint", ok ? "native AXL A2A probe ok" : `native AXL A2A probe failed: ${error ?? "unknown"}`, "peerlane.probe_capability"),
      });
    };

    try {
      await this.axl.a2a(peerPubkey, request);
      log(`NATIVE_A2A probe task=${taskId} to=${to} status=ok`);
      emitProbeTrace(true);
    } catch (err) {
      const message = (err as Error).message;
      log(`NATIVE_A2A probe task=${taskId} to=${to} status=failed:`, message);
      emitProbeTrace(false, message);
    }
  }
}

/** Naive scan for a confidence score in the verifier's free text. */
function extractConfidence(text: string): number | null {
  const m = text.match(/(?:confidence|score)[^\d]{0,10}(0?\.\d{1,3})/i);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
}

function payloadText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const text = (payload as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
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

async function sendWithRetry(
  axl: AxlClient,
  peerPubkey: string,
  message: PeerlaneMessage,
  onRetry: (attempt: number, err: Error) => void,
  attempts = 2,
): Promise<void> {
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await axl.send(peerPubkey, message);
      return;
    } catch (err) {
      lastErr = err as Error;
      if (attempt < attempts) {
        onRetry(attempt, lastErr);
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
      }
    }
  }
  throw lastErr ?? new Error("send failed");
}

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
