# Demo — 90 seconds

A tight walkthrough for judges. Every beat earns its time.

## Pre-roll (before recording)

- Terminal 1: `docker compose up` running, all 4 agents settled, "HTTP+WS listening on :8080" visible
- Terminal 2: `tail -f logs/agent-*.log` (optional — makes the cross-node traffic tangible)
- Browser: http://localhost:5173 loaded; "● connected" badge green; four node names in the header
- Start in **Demo** mode for the clean walkthrough

---

## Beat 1 — what Peerlane is (10s)

> "Peerlane is a peer-to-peer workspace for AI agents. Four specialists —
> coordinator, researcher, verifier, analyst — each runs on its own AXL node.
> The UI you're looking at is driven entirely by live messages flowing
> through the mesh."

> "The simple version: this is not three backend functions called in sequence.
> These are four node identities. Coord starts the task, then the workers pass
> it directly to each other."

[Point to the four node badges and the node identity list with short pubkeys.]

> "Each node advertises capabilities in the registry, like `research.market`
> and `verify.claims`. Coord chooses the route from those capabilities, then
> sends an A2A-style `message/send` payload through AXL."

---

## Beat 2 — submit a task (15s)

Use the **Token claim** preset, or paste into the Task field:

> *"Estimate the 2026 market for on-chain AI inference infrastructure.
>  Flag anything that can't be cross-verified."*

Click **run**.

The UI should react immediately:
- Mesh view starts scrolling through steps
- Node badges light up in amber as they become busy
- The route starts at research, then continues worker-to-worker

---

## Beat 3 — narrate the chain (25s)

> "Watch the Mesh column. The coordinator only starts the route by
> dispatching to research. Research then sends directly to verify over AXL,
> verify sends directly to analyst, and only analyst returns to coord."

Point to the glowing active row (orange left-border).
Point to the worker-to-worker rows: research → verify, then verify → analyst.

> "This is the whole point: coord is not a central task broker. It owns
> the HTTP front door, but the worker path is peer-to-peer:
> research to verify to analyst."

---

## Beat 4 — proof this is really P2P (20s)

Switch to **Proof** mode.

Click the **trace** footer to expand.

> "Here's the proof this isn't a mock. Every row is one AXL message — from,
> to, verb, timestamp, and message id. The node pubkeys are visible on the
> left and attached to the agent breakdown. The MCP tool column shows the
> structured tool intent carried inside the A2A payload. Worker handoffs are
> not routed through a central HTTP service."

Click **copy proof**.

> "This copies the route, node pubkeys, and message ids into a judge-friendly
> verification log."

Point to the gossip count.

> "Workers also gossip intermediate results to peers. The main route stays
> direct, but the mesh gets broadcast state after each step."

If asked to prove it from the terminal:

```bash
docker compose logs --no-color coord research verify analyst | rg 'DISPATCH|FORWARD|RETURN|inbound'
docker compose exec -T coord curl -fsS http://127.0.0.1:9002/topology
docker compose exec -T coord cat /data/registry/mesh-registry.json
```

---

## Beat 5 — the final output (15s)

By now the analyst has returned and the Output pane shows the synthesized
report with a confidence score.

> "The analyst synthesizes a report using the verified findings — never
> the unverified research on its own. Confidence 0.87 comes from the
> verifier's own score, which the analyst respected when shaping its prose."

Click **agent breakdown** to show each contribution.

---

## Beat 6 — close (5s)

> "One screen. Four real AXL nodes. Real task, real mesh traffic.
> Peerlane."

---

## What to skip if you're over time

- Beat 4 (proof of P2P) — the Mesh column already communicates this visually
- Beat 5 details — the Output pane is self-explanatory

## What to add if judges ask for depth

- Show `ps aux | grep -E "axl-node|node dist"` — 8 distinct processes
- Show `docker compose exec -T coord cat /data/registry/mesh-registry.json` — 4 distinct ed25519 pubkeys
- Kill one worker process mid-run and show the coord surfacing a timeout in the UI
- Swap in a different workflow (code review, source comparison) — same mesh, different prompts
