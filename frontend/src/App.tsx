import { useCallback, useEffect, useRef, useState } from "react";
import type {
  LogEntry,
  NodeId,
  Pipeline,
  PipelineStep,
  WsEvent,
} from "./types";
import { postTask, useWs } from "./useWs";

/*
  PEERLANE — light editorial UI.
  Wired to real coordinator WebSocket feed.
*/

// ── Logo ──
function PeerlaneLogo({ size = 24 }: { size?: number }) {
  const m = size / 24;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <line x1={2 * m} y1={4 * m} x2={10 * m} y2={12 * m} stroke="var(--c-accent)" strokeWidth={1.8} />
      <line x1={2 * m} y1={20 * m} x2={10 * m} y2={12 * m} stroke="var(--c-accent)" strokeWidth={1.8} />
      <line x1={22 * m} y1={4 * m} x2={14 * m} y2={12 * m} stroke="var(--c-ink)" strokeWidth={1.8} />
      <line x1={22 * m} y1={20 * m} x2={14 * m} y2={12 * m} stroke="var(--c-ink)" strokeWidth={1.8} />
      <line x1={10 * m} y1={12 * m} x2={14 * m} y2={12 * m} stroke="var(--c-accent)" strokeWidth={2.5} />
    </svg>
  );
}

const NODES: { id: NodeId; name: string; port: number }[] = [
  { id: "coord", name: "coord", port: 9002 },
  { id: "research", name: "research", port: 9012 },
  { id: "verify", name: "verify", port: 9022 },
  { id: "analyst", name: "analyst", port: 9032 },
];

const WORKFLOWS = ["research brief", "due diligence", "source comp.", "code review"];

// Step template. Indices must match coordinator.ts stepUpdate() calls.
const STEP_TEMPLATE: Omit<PipelineStep, "state">[] = [
  { src: "user", dst: "coord", verb: "submit", msg: "" },
  { src: "coord", dst: "research", verb: "dispatch", msg: "gather sources" },
  { src: "coord", dst: "verify", verb: "dispatch", msg: "prepare criteria" },
  { src: "research", dst: "coord", verb: "return", msg: "" },
  { src: "verify", dst: "coord", verb: "return", msg: "" },
  { src: "coord", dst: "analyst", verb: "dispatch", msg: "synthesize" },
  { src: "analyst", dst: "coord", verb: "return", msg: "" },
  { src: "coord", dst: "user", verb: "deliver", msg: "" },
];

function formatTs(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
      "." + String(d.getMilliseconds()).padStart(3, "0").slice(0, 2);
  } catch {
    return "";
  }
}

export default function Peerlane() {
  const [input, setInput] = useState("");
  const [wf, setWf] = useState(0);
  const [running, setRunning] = useState(false);
  const [pipe, setPipe] = useState<Pipeline | null>(null);
  const [busy, setBusy] = useState<Set<NodeId>>(new Set());
  const [result, setResult] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [showTrace, setShowTrace] = useState(false);
  const [contribs, setContribs] = useState<Partial<Record<NodeId, string>>>({});
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logRef = useRef<HTMLDivElement | null>(null);
  const meshRef = useRef<HTMLDivElement | null>(null);

  // ── Handle incoming WS events ──
  const onEvent = useCallback((ev: WsEvent) => {
    switch (ev.kind) {
      case "task_started": {
        setRunning(true);
        setResult(null);
        setConfidence(null);
        setError(null);
        setLog([]);
        setContribs({});
        setBusy(new Set());
        setPipe({
          id: ev.taskId,
          text: ev.question,
          steps: STEP_TEMPLATE.map((s, i) => ({
            ...s,
            msg: i === 0 ? ev.question : s.msg,
            state: i === 0 ? "ok" : "wait",
          })),
        });
        setLog((p) => [
          ...p,
          { t: formatTs(ev.ts), src: "user", dst: "coord", type: "SND", detail: ev.question.slice(0, 80) },
        ]);
        break;
      }

      case "step_update": {
        setPipe((prev) => {
          if (!prev || prev.id !== ev.taskId) return prev;
          const steps = [...prev.steps];
          const cur = steps[ev.stepIndex];
          if (!cur) return prev;
          steps[ev.stepIndex] = {
            ...cur,
            state: ev.state,
            msg: ev.msg ?? cur.msg,
            ts: formatTs(ev.ts),
          };
          return { ...prev, steps };
        });
        break;
      }

      case "message": {
        const m = ev.message;
        setLog((p) => [
          ...p,
          { t: formatTs(m.ts), src: m.from, dst: m.to, type: m.type.slice(0, 3), detail: m.verb },
        ]);
        break;
      }

      case "node_busy": {
        setBusy((prev) => {
          const next = new Set(prev);
          ev.busy ? next.add(ev.node) : next.delete(ev.node);
          return next;
        });
        break;
      }

      case "contribution": {
        setContribs((prev) => ({ ...prev, [ev.node]: ev.text }));
        break;
      }

      case "task_complete": {
        setResult(ev.result);
        setConfidence(ev.confidence);
        setRunning(false);
        break;
      }

      case "task_error": {
        setError(ev.error);
        setRunning(false);
        break;
      }

      case "topology": {
        // Could update an "offline" badge per node — ignore for now, all
        // nodes are assumed online once the WS is connected.
        break;
      }
    }
  }, []);

  const { connected } = useWs(onEvent);

  // Auto-scroll.
  useEffect(() => { meshRef.current?.scrollTo(0, meshRef.current.scrollHeight); }, [pipe]);
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [log]);

  const run = useCallback(async () => {
    if (!input.trim() || running || !connected) return;
    try {
      await postTask(input.trim());
      // task_started event will flip `running` to true and populate pipe.
    } catch (err) {
      setError((err as Error).message);
    }
  }, [input, running, connected]);

  const reset = () => {
    setInput("");
    setPipe(null);
    setResult(null);
    setConfidence(null);
    setError(null);
    setLog([]);
    setContribs({});
    setRunning(false);
    setBusy(new Set());
  };

  const copyResult = () => {
    if (result) {
      navigator.clipboard?.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div style={{
      width: "100%", height: "100vh", background: "var(--c-bg)", color: "var(--c-ink)",
      fontFamily: "var(--f-mono)", display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bitter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        :root {
          --c-bg: #F5F1E8;
          --c-paper: #FAF7F0;
          --c-sunk: #EDE7D7;
          --c-line: #C9BFA8;
          --c-line-soft: #DDD5BE;
          --c-ink: #14110B;
          --c-ink-2: #3C352A;
          --c-dim: #6B624F;
          --c-mute: #9A9076;
          --c-accent: #B64B2E;
          --c-accent-soft: #B64B2E14;
          --c-ok: #2E6B3A;
          --c-err: #A83333;
          --f-serif: 'Bitter', Georgia, serif;
          --f-mono: 'IBM Plex Mono', 'Menlo', monospace;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::selection { background: var(--c-accent); color: var(--c-paper); }
        textarea, select, button { font-family: var(--f-mono); }
        textarea {
          background: var(--c-paper); color: var(--c-ink);
          border: 1px solid var(--c-line); padding: 10px;
          font-size: 13px; line-height: 1.6; resize: none;
          outline: none; width: 100%;
        }
        textarea:focus { border-color: var(--c-ink); }
        textarea::placeholder { color: var(--c-mute); }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--c-line); }
        ::-webkit-scrollbar-thumb:hover { background: var(--c-dim); }
      `}</style>

      {/* Header */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 20px", height: 48,
        borderBottom: "1px solid var(--c-line)",
        background: "var(--c-paper)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <PeerlaneLogo size={24} />
          <span style={{
            fontFamily: "var(--f-serif)", fontSize: 17, fontWeight: 600,
            color: "var(--c-ink)", letterSpacing: "-0.01em",
          }}>
            Peerlane
          </span>
          <span style={{
            fontSize: 11, color: "var(--c-dim)", marginLeft: 6,
            borderLeft: "1px solid var(--c-line)", paddingLeft: 10,
          }}>
            axl mesh · 4 nodes
          </span>
          <span style={{
            fontSize: 10, marginLeft: 8,
            padding: "2px 8px", border: "1px solid var(--c-line)",
            color: connected ? "var(--c-ok)" : "var(--c-err)",
            background: connected ? "transparent" : "var(--c-sunk)",
          }}>
            {connected ? "● connected" : "○ disconnected"}
          </span>
        </div>
        <div style={{ display: "flex" }}>
          {NODES.map((n, i) => (
            <div key={n.id} style={{
              padding: "4px 12px", fontSize: 12,
              color: busy.has(n.id) ? "var(--c-accent)" : "var(--c-ink-2)",
              fontWeight: busy.has(n.id) ? 600 : 500,
              borderLeft: i > 0 ? "1px solid var(--c-line-soft)" : "none",
              transition: "color 0.15s",
              display: "flex", alignItems: "center", gap: 7,
            }}>
              <span style={{
                width: 6, height: 6, display: "inline-block",
                background: busy.has(n.id) ? "var(--c-accent)" : connected ? "var(--c-ok)" : "var(--c-mute)",
              }} />
              {n.name}<span style={{ color: "var(--c-mute)", fontWeight: 400 }}>:{n.port}</span>
            </div>
          ))}
        </div>
      </header>

      {/* Body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* LEFT — Task */}
        <div style={{
          width: 260, flexShrink: 0, borderRight: "1px solid var(--c-line)",
          display: "flex", flexDirection: "column", padding: "14px 14px 12px", gap: 12,
          background: "var(--c-bg)",
        }}>
          <span style={{ fontSize: 11, color: "var(--c-dim)", fontWeight: 500 }}>Task</span>
          <textarea
            rows={6}
            placeholder="describe a task for the network"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={running}
          />

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "var(--c-dim)", flexShrink: 0 }}>wf</span>
            <div style={{ display: "flex", gap: 0, flex: 1 }}>
              {WORKFLOWS.map((w, i) => (
                <button
                  key={w}
                  onClick={() => setWf(i)}
                  disabled={running}
                  style={{
                    flex: 1, padding: "6px 0", fontSize: 11,
                    border: "1px solid var(--c-line)", marginLeft: i > 0 ? -1 : 0,
                    background: wf === i ? "var(--c-ink)" : "var(--c-paper)",
                    color: wf === i ? "var(--c-bg)" : "var(--c-ink-2)",
                    cursor: running ? "default" : "pointer",
                    fontWeight: wf === i ? 600 : 400,
                  }}
                  title={w}
                >
                  {w.split(" ").map((word) => word[0]).join("").toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 6, marginTop: "auto" }}>
            <button
              onClick={run}
              disabled={running || !input.trim() || !connected}
              style={{
                flex: 1, padding: "10px 0", fontSize: 13, border: "none", fontWeight: 600,
                background: running || !input.trim() || !connected ? "var(--c-sunk)" : "var(--c-ink)",
                color: running || !input.trim() || !connected ? "var(--c-mute)" : "var(--c-bg)",
                cursor: running || !input.trim() || !connected ? "default" : "pointer",
                letterSpacing: "0.02em",
              }}
            >
              {running ? "running…" : "run →"}
            </button>
            <button
              onClick={reset}
              style={{
                padding: "10px 14px", fontSize: 12, background: "var(--c-paper)",
                color: "var(--c-dim)", border: "1px solid var(--c-line)", cursor: "pointer",
              }}
            >
              reset
            </button>
          </div>

          <div style={{
            marginTop: 4, paddingTop: 10, borderTop: "1px solid var(--c-line-soft)",
            fontSize: 11, color: "var(--c-dim)", lineHeight: 1.8,
          }}>
            <div style={{ color: "var(--c-ink-2)", marginBottom: 4, fontWeight: 500 }}>topology</div>
            transport <span style={{ color: "var(--c-ink)" }}>axl / yggdrasil</span><br />
            encryption <span style={{ color: "var(--c-ink)" }}>e2e curve25519</span><br />
            protocol <span style={{ color: "var(--c-ink)" }}>mcp + a2a</span><br />
            broker <span style={{ color: "var(--c-accent)" }}>none</span>
          </div>
        </div>

        {/* CENTER — Mesh */}
        <div style={{
          flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0,
          background: "var(--c-paper)",
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "0 18px", height: 36, borderBottom: "1px solid var(--c-line)",
          }}>
            <span style={{ fontSize: 11, color: "var(--c-dim)", fontWeight: 500 }}>Mesh</span>
            {pipe && (
              <span style={{ fontSize: 11, color: "var(--c-dim)" }}>
                task:<span style={{ color: "var(--c-ink)" }}>{pipe.id}</span>
                <span style={{ margin: "0 8px", color: "var(--c-mute)" }}>·</span>
                <span style={{ color: "var(--c-ink)" }}>{pipe.steps.filter((s) => s.state === "ok").length}</span>
                <span style={{ color: "var(--c-mute)" }}>/{pipe.steps.length}</span>
              </span>
            )}
          </div>

          <div ref={meshRef} style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
            {!pipe && !error && (
              <div style={{
                height: "100%", display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 14,
              }}>
                <PeerlaneLogo size={40} />
                <div style={{
                  fontSize: 12, color: "var(--c-dim)", textAlign: "center",
                  lineHeight: 1.7, maxWidth: 280,
                }}>
                  submit a task to observe<br />
                  cross-node execution over axl
                </div>
              </div>
            )}

            {error && (
              <div style={{
                margin: "20px 18px", padding: "12px",
                border: "1px solid var(--c-err)", background: "var(--c-paper)",
                color: "var(--c-err)", fontSize: 12, lineHeight: 1.6,
              }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>task failed</div>
                {error}
              </div>
            )}

            {pipe && pipe.steps.map((step, i) => {
              const isWait = step.state === "wait";
              const isRun = step.state === "run";
              const isOk = step.state === "ok";
              const isErr = step.state === "err";
              return (
                <div key={i} style={{
                  display: "flex", alignItems: "flex-start", padding: "6px 18px",
                  opacity: isWait ? 0.35 : 1,
                  background: isRun ? "var(--c-accent-soft)" : "transparent",
                  transition: "opacity 0.3s, background 0.3s",
                  borderLeft: isRun ? "2px solid var(--c-accent)" :
                              isErr ? "2px solid var(--c-err)" : "2px solid transparent",
                }}>
                  <span style={{
                    width: 24, fontSize: 11, color: "var(--c-mute)",
                    textAlign: "right", marginRight: 14, flexShrink: 0, paddingTop: 1,
                  }}>
                    {String(i).padStart(2, "0")}
                  </span>
                  <span style={{
                    width: 14, fontSize: 13, flexShrink: 0, marginRight: 10,
                    fontWeight: 600, paddingTop: 0,
                    color: isOk ? "var(--c-ok)" :
                           isRun ? "var(--c-accent)" :
                           isErr ? "var(--c-err)" : "var(--c-mute)",
                  }}>
                    {isOk ? "✓" : isRun ? "›" : isErr ? "✗" : "·"}
                  </span>
                  <span style={{
                    width: 160, flexShrink: 0, fontSize: 12.5,
                    display: "flex", gap: 5, alignItems: "baseline", fontWeight: 500,
                  }}>
                    <span style={{ color: "var(--c-ink)" }}>{step.src}</span>
                    <span style={{ color: "var(--c-mute)", fontSize: 10 }}>→</span>
                    <span style={{ color: "var(--c-ink)" }}>{step.dst}</span>
                  </span>
                  <span style={{
                    width: 72, flexShrink: 0, fontSize: 11,
                    color: "var(--c-dim)", fontStyle: "italic",
                  }}>
                    {step.verb}
                  </span>
                  {!isWait && step.msg && (
                    <span style={{
                      fontSize: 12, color: "var(--c-ink-2)", overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0,
                    }}>
                      {step.msg.length > 100 ? step.msg.slice(0, 100) + " …" : step.msg}
                    </span>
                  )}
                  {step.ts && (
                    <span style={{
                      fontSize: 11, color: "var(--c-mute)",
                      marginLeft: 12, flexShrink: 0,
                    }}>
                      {step.ts}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT — Output */}
        <div style={{
          width: 340, flexShrink: 0, borderLeft: "1px solid var(--c-line)",
          display: "flex", flexDirection: "column", overflow: "hidden",
          background: "var(--c-bg)",
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "0 16px", height: 36, borderBottom: "1px solid var(--c-line)",
          }}>
            <span style={{ fontSize: 11, color: "var(--c-dim)", fontWeight: 500 }}>Output</span>
            {result && (
              <button
                onClick={copyResult}
                style={{
                  fontSize: 11, padding: "3px 10px", background: "var(--c-paper)",
                  border: "1px solid var(--c-line)",
                  color: copied ? "var(--c-ok)" : "var(--c-ink-2)", cursor: "pointer",
                }}
              >
                {copied ? "copied" : "copy"}
              </button>
            )}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            {!result && !running && !error && (
              <div style={{
                height: "100%", display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: 12, color: "var(--c-mute)",
              }}>
                —
              </div>
            )}

            {running && !result && (
              <div style={{
                height: "100%", display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: 12, color: "var(--c-dim)",
              }}>
                waiting for agents …
              </div>
            )}

            {result && (
              <div>
                <pre style={{
                  fontSize: 12.5, lineHeight: 1.75, color: "var(--c-ink)",
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                  fontFamily: "var(--f-mono)", margin: 0,
                }}>
                  {result}
                </pre>

                {confidence !== null && (
                  <div style={{
                    marginTop: 18, paddingTop: 12, borderTop: "1px solid var(--c-line-soft)",
                    fontSize: 11, color: "var(--c-dim)", lineHeight: 1.9,
                  }}>
                    <span>confidence </span>
                    <span style={{ color: "var(--c-ok)", fontWeight: 600 }}>{confidence.toFixed(2)}</span>
                    <span style={{ margin: "0 6px", color: "var(--c-mute)" }}>·</span>
                    <span>agents </span>
                    <span style={{ color: "var(--c-ink)", fontWeight: 500 }}>
                      {Object.keys(contribs).length}
                    </span>
                  </div>
                )}

                {Object.keys(contribs).length > 0 && (
                  <details style={{ marginTop: 12 }}>
                    <summary style={{
                      fontSize: 11, color: "var(--c-ink-2)", cursor: "pointer",
                      listStyle: "none", display: "flex", alignItems: "center", gap: 6,
                      fontWeight: 500,
                    }}>
                      <span style={{ fontSize: 9 }}>▸</span> agent breakdown
                    </summary>
                    <div style={{ marginTop: 10 }}>
                      {Object.entries(contribs).map(([nid, text]) => (
                        <div key={nid} style={{
                          padding: "8px 0", borderTop: "1px solid var(--c-line-soft)",
                        }}>
                          <div style={{
                            fontSize: 11, color: "var(--c-ink)", marginBottom: 4,
                            fontWeight: 600,
                          }}>
                            {nid}
                          </div>
                          <div style={{
                            fontSize: 11, color: "var(--c-ink-2)", lineHeight: 1.6,
                          }}>
                            {text.slice(0, 240)}{text.length > 240 ? " …" : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Trace footer */}
      <div style={{ borderTop: "1px solid var(--c-line)", background: "var(--c-paper)" }}>
        <button
          onClick={() => setShowTrace(!showTrace)}
          style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 18px", background: "transparent", border: "none", cursor: "pointer",
            color: "var(--c-ink-2)", fontSize: 11, fontWeight: 500,
          }}
        >
          <span>trace · <span style={{ color: "var(--c-ink)" }}>{log.length}</span> events</span>
          <span style={{
            transition: "transform 0.15s",
            transform: showTrace ? "rotate(180deg)" : "none",
            fontSize: 12,
          }}>
            ▴
          </span>
        </button>

        {showTrace && (
          <div
            ref={logRef}
            style={{
              maxHeight: 200, overflowY: "auto", padding: "0 18px 10px",
              background: "var(--c-sunk)",
              borderTop: "1px solid var(--c-line-soft)",
            }}
          >
            {log.length === 0 ? (
              <div style={{ fontSize: 11, color: "var(--c-mute)", padding: "10px 0" }}>
                no events
              </div>
            ) : (
              <table style={{
                width: "100%", borderCollapse: "collapse",
                fontSize: 11, lineHeight: 1.7,
              }}>
                <thead>
                  <tr style={{
                    color: "var(--c-dim)",
                    borderBottom: "1px solid var(--c-line)",
                  }}>
                    <th style={{ textAlign: "left", fontWeight: 500, padding: "5px 0", width: 90 }}>time</th>
                    <th style={{ textAlign: "left", fontWeight: 500, width: 80 }}>from</th>
                    <th style={{ textAlign: "left", fontWeight: 500, width: 14 }}></th>
                    <th style={{ textAlign: "left", fontWeight: 500, width: 80 }}>to</th>
                    <th style={{ textAlign: "left", fontWeight: 500, width: 50 }}>type</th>
                    <th style={{ textAlign: "left", fontWeight: 500 }}>detail</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((e, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--c-line-soft)" }}>
                      <td style={{ color: "var(--c-dim)", padding: "4px 0" }}>{e.t}</td>
                      <td style={{ color: "var(--c-ink)", fontWeight: 500 }}>{e.src}</td>
                      <td style={{ color: "var(--c-mute)", fontSize: 10 }}>→</td>
                      <td style={{ color: "var(--c-ink)", fontWeight: 500 }}>{e.dst}</td>
                      <td style={{ color: "var(--c-accent)", fontWeight: 600 }}>{e.type}</td>
                      <td style={{
                        color: "var(--c-ink-2)", maxWidth: 400,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {e.detail}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
