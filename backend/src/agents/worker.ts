/**
 * Worker agent base.
 *
 * Runs a loop:
 *   1. Register our AXL pubkey under our role.
 *   2. Wait until all peers are in the registry.
 *   3. Poll AXL /recv for DISPATCH messages addressed to us.
 *   4. Call the LLM with our role-specific system prompt.
 *   5. Either forward the task to the next peer in the route, or return the
 *      final analyst result to coord.
 *
 * Each worker is a separate Node.js process running its own AXL node
 * on a distinct port. Communication is real AXL peer-to-peer — we never
 * speak to the coordinator through any intermediary.
 */

import { AxlClient, pollRecv } from "../axl/client.js";
import {
  registerSelf,
  waitForAllPeers,
  lookupPubkey,
  type PeerRegistry,
} from "../axl/registry.js";
import { callLlm } from "../llm/client.js";
import type {
  ChainTraceEntry,
  DispatchPayload,
  NodeId,
  PeerlaneMessage,
  ReturnPayload,
} from "../types/messages.js";

export interface WorkerConfig {
  role: Exclude<NodeId, "coord">;
  axlPort: number;           // AXL HTTP bridge port for this node
  registryPath: string;      // shared pubkey registry file
  systemPrompt: string;      // LLM system prompt for this role
}

function log(role: string, ...args: unknown[]) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${role}]`, ...args);
}

export async function runWorker(cfg: WorkerConfig): Promise<void> {
  const axl = new AxlClient(cfg.axlPort);
  const role = cfg.role;

  log(role, "starting, AXL bridge =", `127.0.0.1:${cfg.axlPort}`);

  // Get our AXL identity.
  const myPubkey = await waitForAxlReady(axl);
  log(role, "AXL ready, pubkey =", short(myPubkey));

  // Publish ourselves.
  await registerSelf(cfg.registryPath, role, myPubkey, cfg.axlPort);
  log(role, "registered in peer registry");

  // Wait for everyone else to register.
  const registry = await waitForAllPeers(cfg.registryPath);
  log(role, "all peers online:",
    Object.entries(registry.peers)
      .map(([r, v]) => `${r}=${short(v!.pubkey)}`)
      .join(" "));

  // Enter receive loop.
  const abort = new AbortController();
  const shutdown = () => abort.abort();
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  log(role, "entering recv loop");
  await pollRecv(
    axl,
    async (from, msg) => {
      if (msg.type !== "DISPATCH") {
        log(role, "ignoring non-DISPATCH message:", msg.type);
        return;
      }
      if (msg.to !== role) {
        log(role, "ignoring message not for us, to =", msg.to);
        return;
      }
      await handleDispatch(axl, cfg, registry, msg);
    },
    (err) => log(role, "recv error:", err.message),
    abort.signal,
  );

  log(role, "shutdown complete");
}

async function handleDispatch(
  axl: AxlClient,
  cfg: WorkerConfig,
  registry: PeerRegistry,
  incoming: PeerlaneMessage,
): Promise<void> {
  const payload = incoming.payload as DispatchPayload;
  const role = cfg.role;

  log(role, `DISPATCH received for task=${incoming.taskId} verb="${incoming.verb}"`);

  const startedAt = Date.now();
  let result: ReturnPayload;
  try {
    // Build the user message combining the question with prior findings, if any.
    const userMsg = buildUserMessage(payload);
    const llm = await callLlm({
      system: cfg.systemPrompt,
      user: userMsg,
      maxTokens: 800,
    });
    result = { text: llm.text };
    log(role, `LLM done in ${Date.now() - startedAt}ms, ${llm.text.length} chars`);
  } catch (err) {
    const msg = (err as Error).message;
    log(role, "LLM error:", msg);
    result = { text: "", error: msg };
  }

  const priorFindings = { ...(payload.priorFindings ?? {}), [role]: result.text };
  const contributions = { ...(payload.contributions ?? {}), [role]: result.text };
  const trace = [...(payload.trace ?? []), traceFrom(incoming)];

  if (!result.error) {
    const [next, ...remainingRoute] = payload.route ?? [];
    if (next) {
      const forward: PeerlaneMessage = {
        v: 1,
        mid: crypto.randomUUID(),
        taskId: incoming.taskId,
        parentMid: incoming.mid,
        from: role,
        to: next.node,
        type: "DISPATCH",
        verb: next.verb,
        payload: {
          question: payload.question,
          context: payload.context,
          priorFindings,
          contributions,
          route: remainingRoute,
          trace,
        } satisfies DispatchPayload,
        ts: new Date().toISOString(),
      };

      try {
        await axl.send(lookupPubkey(registry, next.node), forward);
        log(role, `FORWARD sent task=${incoming.taskId} to=${next.node} verb="${next.verb}"`);
        return;
      } catch (err) {
        const msg = (err as Error).message;
        log(role, "AXL forward failed:", msg);
        result = { text: "", error: msg };
      }
    }
  }

  // Only the final hop returns to coord. Earlier workers forward directly to
  // the next peer, so coord is no longer orchestrating every subtask.
  const reply: PeerlaneMessage = {
    v: 1,
    mid: crypto.randomUUID(),
    taskId: incoming.taskId,
    parentMid: incoming.mid,
    from: role,
    to: "coord",
    type: result.error ? "ERROR" : "RETURN",
    verb: `${role}.result`,
    payload: {
      ...result,
      contributions,
      trace,
    } satisfies ReturnPayload,
    ts: new Date().toISOString(),
  };

  try {
    await axl.send(lookupPubkey(registry, "coord"), reply);
    log(role, `RETURN sent for task=${incoming.taskId}`);
  } catch (err) {
    log(role, "AXL send failed:", (err as Error).message);
  }
}

function buildUserMessage(p: DispatchPayload): string {
  const lines: string[] = [];
  lines.push(p.question);
  if (p.context) lines.push("", `Context: ${p.context}`);
  if (p.priorFindings) {
    lines.push("", "Prior findings from other agents:");
    for (const [role, text] of Object.entries(p.priorFindings)) {
      lines.push(`--- ${role} ---`);
      lines.push(text);
    }
  }
  return lines.join("\n");
}

/** Block until the AXL bridge responds to /topology. */
async function waitForAxlReady(axl: AxlClient, timeoutMs = 30_000): Promise<string> {
  const start = Date.now();
  let lastErr: Error | null = null;
  while (Date.now() - start < timeoutMs) {
    try {
      return await axl.publicKey();
    } catch (err) {
      lastErr = err as Error;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`AXL bridge did not become ready: ${lastErr?.message}`);
}

function short(pk: string): string {
  return pk.length > 10 ? pk.slice(0, 8) + "…" : pk;
}

function traceFrom(message: PeerlaneMessage): ChainTraceEntry {
  return {
    mid: message.mid,
    from: message.from,
    to: message.to,
    type: message.type,
    verb: message.verb,
    ts: message.ts,
  };
}
