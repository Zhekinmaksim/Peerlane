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

import http from "node:http";
import { AxlClient, pollRecv } from "../axl/client.js";
import {
  registerSelf,
  waitForAllPeers,
  lookupPubkey,
  type PeerRegistry,
} from "../axl/registry.js";
import { attachProtocol, capabilitiesFor, makeAgentCard } from "../axl/protocols.js";
import { callLlm } from "../llm/client.js";
import type {
  ChainTraceEntry,
  ClarifyPayload,
  ClarifyResponsePayload,
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

  const a2aServer = role === "research"
    ? startNativeA2AServer(cfg, myPubkey)
    : null;

  // Publish ourselves.
  await registerSelf(cfg.registryPath, role, myPubkey, cfg.axlPort, {
    capabilities: capabilitiesFor(role),
    agentCard: makeAgentCard(role, myPubkey, cfg.axlPort),
  });
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
      if (isNativeA2ARequest(msg)) {
        await handleNativeA2AOverRecv(axl, cfg, from, msg);
        return;
      }
      if (msg.to !== role) {
        log(role, "ignoring message not for us, to =", msg.to);
        return;
      }
      if (msg.type === "DISPATCH") {
        await handleDispatch(axl, cfg, registry, msg);
        return;
      }
      if (msg.type === "CLARIFY" && role === "research") {
        await handleClarify(axl, cfg, registry, msg);
        return;
      }
      if (msg.type === "GOSSIP") {
        log(role, `GOSSIP received from=${msg.from} task=${msg.taskId}`);
        return;
      }
      log(role, "ignoring message:", msg.type);
    },
    (err) => log(role, "recv error:", err.message),
    abort.signal,
  );

  a2aServer?.close();
  log(role, "shutdown complete");
}

function isNativeA2ARequest(msg: PeerlaneMessage): boolean {
  return !!findJsonRpcRequest(msg).method;
}

async function handleNativeA2AOverRecv(
  axl: AxlClient,
  cfg: WorkerConfig,
  fromPubkey: string,
  msg: PeerlaneMessage,
): Promise<void> {
  const role = cfg.role;
  const request = findJsonRpcRequest(msg);
  const raw = safeJsonSnippet(msg);
  const text = request.params?.message?.parts?.[0]?.text ?? "";
  log(role, `NATIVE_A2A received via recv method=${request.method ?? "unknown"} bytes=${text.length} raw=${raw}`);

  const response = {
    jsonrpc: "2.0",
    id: request.id ?? null,
    result: {
      message: {
        role: "agent",
        messageId: `native-a2a-${crypto.randomUUID()}`,
        parts: [{
          kind: "text",
          text: JSON.stringify({
            ok: true,
            node: role,
            receivedMessageId: request.params?.message?.messageId,
            note: `Native AXL /a2a reached Peerlane ${role} through the mesh.`,
          }),
        }],
      },
    },
  };

  await axl.sendRaw(fromPubkey, JSON.stringify({ a2a: true, response }));
  log(role, `NATIVE_A2A response sent to peer=${short(fromPubkey)}`);
}

type JsonRpcRequest = {
  id?: string | number | null;
  method?: string;
  params?: { message?: { messageId?: string; parts?: Array<{ text?: string; kind?: string }> } };
};

function findJsonRpcRequest(value: unknown, depth = 0): JsonRpcRequest {
  if (!value || typeof value !== "object" || depth > 1) return {};
  const record = value as Record<string, unknown>;
  if (typeof record.method === "string" && (record.jsonrpc === "2.0" || "params" in record)) {
    return record as JsonRpcRequest;
  }
  if (record.a2a === true && record.request && typeof record.request === "object") {
    const found = findJsonRpcRequest(record.request, depth + 1);
    if (found.method) return found;
  }
  return {};
}

function safeJsonSnippet(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 700);
  } catch {
    return "[unserializable]";
  }
}

function startNativeA2AServer(cfg: WorkerConfig, pubkey: string): http.Server | null {
  const port = Number(process.env.PEERLANE_A2A_PORT ?? 9004);
  const role = cfg.role;
  const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");

    if (req.method === "GET") {
      res.end(JSON.stringify({
        name: `Peerlane ${role}`,
        protocolVersion: "1.0",
        url: `axl://pubkey/${pubkey}`,
        skills: capabilitiesFor(role),
      }));
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405);
      res.end(JSON.stringify({ error: "method not allowed" }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body) as {
          jsonrpc?: "2.0";
          id?: string | number;
          method?: string;
          params?: { message?: { messageId?: string; parts?: Array<{ text?: string }> } };
        };
        const text = parsed.params?.message?.parts?.[0]?.text ?? "";
        log(role, `NATIVE_A2A received method=${parsed.method ?? "unknown"} bytes=${text.length}`);
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id ?? null,
          result: {
            message: {
              role: "agent",
              messageId: `native-a2a-${crypto.randomUUID()}`,
              parts: [{
                kind: "text",
                text: JSON.stringify({
                  ok: true,
                  node: role,
                  pubkey,
                  receivedMessageId: parsed.params?.message?.messageId,
                  note: "Native AXL /a2a bridge reached Peerlane research.",
                }),
              }],
            },
          },
        }));
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: (err as Error).message },
        }));
      }
    });
  });

  server.on("error", (err) => {
    log(role, `NATIVE_A2A server error: ${(err as Error).message}`);
  });
  server.listen(port, "127.0.0.1", () => {
    log(role, `NATIVE_A2A listening on :${port}`);
  });
  return server;
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
  let trace = [...(payload.trace ?? []), traceFrom(incoming)];
  const currentCapability = payload.capability ?? capabilitiesFor(role)[0];

  if (!result.error && role === "verify" && !payload.clarifications?.research) {
    const clarification = await requestResearchClarification(axl, cfg, registry, incoming, payload, trace);
    trace = clarification.trace;
    if (clarification.text) {
      result = {
        ...result,
        text: [
          result.text,
          `Research clarification: ${clarification.text}`,
        ].join(" "),
      };
    }
  }

  if (!result.error) {
    await gossip(axl, cfg, registry, incoming, result.text, currentCapability);
  }

  if (!result.error) {
    const [next, ...remainingRoute] = payload.route ?? [];
    if (next) {
      const forward = attachProtocol({
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
          capability: next.capability,
          context: payload.context,
          priorFindings,
          clarifications: payload.clarifications,
          contributions,
          route: remainingRoute,
          trace,
        } satisfies DispatchPayload,
        ts: new Date().toISOString(),
      }, next.capability, payload.question);

      try {
        await sendWithRetry(axl, lookupPubkey(registry, next.node), forward, (attempt, err) => {
          log(role, `RETRY forward to=${next.node} attempt=${attempt}:`, err.message);
        });
        log(role, `FORWARD sent task=${incoming.taskId} to=${next.node} capability="${next.capability}" verb="${next.verb}"`);
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
  const reply = attachProtocol({
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
  }, currentCapability, result.text);

  try {
    await sendWithRetry(axl, lookupPubkey(registry, "coord"), reply, (attempt, err) => {
      log(role, `RETRY return to=coord attempt=${attempt}:`, err.message);
    });
    log(role, `RETURN sent for task=${incoming.taskId}`);
  } catch (err) {
    log(role, "AXL send failed:", (err as Error).message);
  }
}

async function handleClarify(
  axl: AxlClient,
  cfg: WorkerConfig,
  registry: PeerRegistry,
  incoming: PeerlaneMessage,
): Promise<void> {
  const payload = incoming.payload as ClarifyPayload;
  const role = cfg.role;
  log(role, `CLARIFY received from=${incoming.from} task=${incoming.taskId}`);

  let result: ClarifyResponsePayload;
  try {
    const llm = await callLlm({
      system: cfg.systemPrompt,
      user: [
        payload.question,
        "",
        `Clarification request: ${payload.request}`,
        "",
        "Prior findings:",
        JSON.stringify(payload.priorFindings ?? {}, null, 2),
      ].join("\n"),
      maxTokens: 360,
    });
    result = { text: llm.text };
  } catch (err) {
    result = { text: "", error: (err as Error).message };
  }

  const reply = attachProtocol({
    v: 1,
    mid: crypto.randomUUID(),
    taskId: incoming.taskId,
    parentMid: incoming.mid,
    from: role,
    to: incoming.from,
    type: "CLARIFY_RESPONSE",
    verb: "clarify_response",
    payload: result,
    ts: new Date().toISOString(),
  }, "research.market", result.text || result.error || "clarification failed", "peerlane.clarify_response");

  await sendWithRetry(axl, lookupPubkey(registry, incoming.from), reply, (attempt, err) => {
    log(role, `RETRY clarify_response to=${incoming.from} attempt=${attempt}:`, err.message);
  });
  log(role, `CLARIFY_RESPONSE sent task=${incoming.taskId} to=${incoming.from}`);
}

async function requestResearchClarification(
  axl: AxlClient,
  cfg: WorkerConfig,
  registry: PeerRegistry,
  incoming: PeerlaneMessage,
  payload: DispatchPayload,
  trace: ChainTraceEntry[],
): Promise<{ text: string; trace: ChainTraceEntry[] }> {
  const role = cfg.role;
  const request = attachProtocol({
    v: 1,
    mid: crypto.randomUUID(),
    taskId: incoming.taskId,
    parentMid: incoming.mid,
    from: role,
    to: "research",
    type: "CLARIFY",
    verb: "clarify_evidence",
    payload: {
      question: payload.question,
      request: "Verify needs one extra evidence-quality note before analyst synthesis.",
      priorFindings: payload.priorFindings,
    } satisfies ClarifyPayload,
    ts: new Date().toISOString(),
  }, "verify.claims", payload.question, "peerlane.clarify_evidence");

  try {
    await sendWithRetry(axl, lookupPubkey(registry, "research"), request, (attempt, err) => {
      log(role, `RETRY clarify to=research attempt=${attempt}:`, err.message);
    });
    log(role, `CLARIFY sent task=${incoming.taskId} to=research`);
  } catch (err) {
    log(role, "CLARIFY failed:", (err as Error).message);
    return { text: "", trace: [...trace, traceFrom(request)] };
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    const got = await axl.recv(5_000);
    if (!got) continue;
    const msg = got.message;
    if (msg.type === "CLARIFY_RESPONSE" && msg.parentMid === request.mid && msg.from === "research") {
      const response = msg.payload as ClarifyResponsePayload;
      log(role, `CLARIFY_RESPONSE received task=${incoming.taskId} from=research`);
      return {
        text: response.text,
        trace: [...trace, traceFrom(request), traceFrom(msg)],
      };
    }
    log(role, `stashed unrelated message while waiting clarify: ${msg.type} from=${msg.from}`);
  }

  log(role, `CLARIFY timed out task=${incoming.taskId}`);
  return { text: "", trace: [...trace, traceFrom(request)] };
}

async function gossip(
  axl: AxlClient,
  cfg: WorkerConfig,
  registry: PeerRegistry,
  incoming: PeerlaneMessage,
  text: string,
  capability: NonNullable<DispatchPayload["capability"]>,
): Promise<void> {
  const role = cfg.role;
  const peers = Object.keys(registry.peers)
    .filter((peer): peer is NodeId => peer !== role && !!registry.peers[peer as NodeId]);

  let sent = 0;
  for (const peer of peers) {
    const msg = attachProtocol({
      v: 1,
      mid: crypto.randomUUID(),
      taskId: incoming.taskId,
      parentMid: incoming.mid,
      from: role,
      to: peer,
      type: "GOSSIP",
      verb: `${role}.gossip`,
      payload: {
        text,
        capability,
        sourceMid: incoming.mid,
      },
      ts: new Date().toISOString(),
    }, capability, text);
    try {
      await sendWithRetry(axl, lookupPubkey(registry, peer), msg, (attempt, err) => {
        log(role, `RETRY gossip to=${peer} attempt=${attempt}:`, err.message);
      });
      sent += 1;
    } catch (err) {
      log(role, `GOSSIP failed to=${peer}:`, (err as Error).message);
    }
  }
  log(role, `GOSSIP broadcast task=${incoming.taskId} peers=${sent}`);
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
  if (p.clarifications) {
    lines.push("", "Clarifications requested during peer negotiation:");
    for (const [role, text] of Object.entries(p.clarifications)) {
      lines.push(`--- ${role} clarification ---`);
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
  const capability = message.protocol?.a2a.message.metadata.capability as ChainTraceEntry["capability"];
  return {
    mid: message.mid,
    from: message.from,
    to: message.to,
    type: message.type,
    verb: message.verb,
    capability,
    protocolBinding: message.protocol?.binding,
    mcpTool: message.protocol?.mcp?.toolName,
    ts: message.ts,
  };
}

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
