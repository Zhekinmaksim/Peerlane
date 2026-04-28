#!/usr/bin/env node

import WebSocket from "../backend/node_modules/ws/wrapper.mjs";

const wsUrl = process.env.PEERLANE_WS_URL ?? "ws://127.0.0.1:5173/ws";
const taskUrl = process.env.PEERLANE_TASK_URL ?? "http://127.0.0.1:5173/task";
const question = process.env.PEERLANE_SMOKE_QUESTION
  ?? "Smoke test: summarize why this Peerlane run proves AXL peer-to-peer communication.";
const required = new Set(["task_started", "message", "contribution", "task_complete"]);
const seen = new Set();
const requiredMcpTools = new Set([
  "peerlane.probe_capability",
  "peerlane.gather_sources",
  "peerlane.clarify_evidence",
  "peerlane.clarify_response",
  "peerlane.synthesize_report",
]);
const seenMcpTools = new Set();
let sawLiveWorkerStep = false;

const timeoutMs = Number(process.env.PEERLANE_SMOKE_TIMEOUT_MS ?? 90_000);
const startedAt = Date.now();

function log(...args) {
  console.log("[smoke-ws]", ...args);
}

function fail(message) {
  console.error("[smoke-ws] FAIL:", message);
  process.exit(1);
}

const ws = new WebSocket(wsUrl);

const timer = setTimeout(() => {
  fail([
    `timed out after ${timeoutMs}ms`,
    `seen events: ${Array.from(seen).join(", ") || "none"}`,
    `seen mcp: ${Array.from(seenMcpTools).join(", ") || "none"}`,
    `live worker step: ${sawLiveWorkerStep}`,
  ].join("; "));
}, timeoutMs);

ws.on("open", async () => {
  log("connected", wsUrl);
  const res = await fetch(taskUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    fail(`POST /task failed: ${res.status} ${body}`);
  }
  log("task accepted");
});

ws.on("message", (raw) => {
  let evt;
  try {
    evt = JSON.parse(raw.toString());
  } catch {
    fail(`received non-JSON WS frame: ${raw.toString().slice(0, 120)}`);
  }

  if (evt.kind) {
    seen.add(evt.kind);
    log("event", evt.kind);
  }

  if (evt.kind === "message" && evt.message?.protocol?.mcp?.toolName) {
    seenMcpTools.add(evt.message.protocol.mcp.toolName);
  }

  if (evt.kind === "step_update" && evt.state === "run" && [2, 3, 4].includes(evt.stepIndex)) {
    sawLiveWorkerStep = true;
  }

  const missingEvents = Array.from(required).filter((kind) => !seen.has(kind));
  const missingMcp = Array.from(requiredMcpTools).filter((tool) => !seenMcpTools.has(tool));
  if (missingEvents.length === 0 && missingMcp.length === 0 && sawLiveWorkerStep) {
    clearTimeout(timer);
    log(`PASS in ${Date.now() - startedAt}ms`);
    ws.close();
    process.exit(0);
  }
});

ws.on("error", (err) => fail(err.message));
ws.on("close", () => {
  const missingEvents = Array.from(required).filter((kind) => !seen.has(kind));
  const missingMcp = Array.from(requiredMcpTools).filter((tool) => !seenMcpTools.has(tool));
  if (missingEvents.length > 0 || missingMcp.length > 0 || !sawLiveWorkerStep) {
    fail([
      "socket closed before required proof",
      `missing events: ${missingEvents.join(", ") || "none"}`,
      `missing mcp: ${missingMcp.join(", ") || "none"}`,
      `live worker step: ${sawLiveWorkerStep}`,
    ].join("; "));
  }
});
