# Demo — 3 minutes

A focused walkthrough for ETHGlobal judges. The goal is to show utility first,
then prove the AXL depth without turning the video into a terminal session.

For subtitle timing, see
[`docs/DEMO_VIDEO_SCRIPT.md`](DEMO_VIDEO_SCRIPT.md).

## Pre-roll

- Terminal 1: `docker compose up` running, all 4 agents settled, `HTTP+WS listening on :8080` visible.
- Browser: `http://localhost:5173` loaded, badge says `live mesh`, four node names visible in the header.
- Start in **Demo** mode.
- Keep one terminal tab ready for registry, topology, and log proof.

## Beat 1 — hook (20s)

> Most multi-agent demos are still centralized. Peerlane shows four AI agents
> completing one task across four separate Gensyn AXL nodes, with no central
> worker broker.

Point to `coord`, `research`, `verify`, and `analyst`.

> Each role is its own process, AXL node, public key, and capability card.
> Coord receives the browser task, but the workers hand off directly.

## Beat 2 — submit a useful task (35s)

Click **Protocol DD** or paste:

```text
Run due diligence on a decentralized AI compute protocol:
summarize traction, technical risk, token risk, and open questions.
```

Click **run**.

> Coord discovers the research capability from the registry, probes research
> through AXL's native A2A bridge, then sends the first AXL message.

## Beat 3 — narrate live peer-to-peer handoffs (60s)

Watch the Mesh column and point at rows as they change.

> Research gathers context and gossips progress to the mesh. Then research
> forwards directly to verify over AXL. Coord is observing the proof signal,
> not brokering the worker route.

When clarify rows appear:

> Verify can negotiate with research directly. It sends `CLARIFY`, receives
> `CLARIFY_RESPONSE`, and only then forwards verified claims to analyst.

When the output appears:

> Analyst returns the final report to coord. The output includes separate
> research, verification, and synthesis contributions.

Open **agent breakdown** briefly.

## Beat 4 — proof mode (45s)

Switch to **Proof** mode and expand the trace footer.

> Proof mode shows this is real AXL traffic: sender, receiver, message id,
> parent id, timestamp, MCP tool intent, gossip, Agent Cards, capabilities,
> and distinct AXL pubkeys.

Click **copy proof**.

> This copies a judge-verifiable bundle with route, pubkeys, message ids,
> MCP tool names, and terminal verification commands.

## Beat 5 — terminal proof (30s)

Show only the highest-signal commands:

```bash
docker compose logs --no-color coord research verify analyst | rg 'NATIVE_A2A|DISPATCH|FORWARD|CLARIFY|GOSSIP|RETURN'
docker compose exec -T coord cat /data/registry/mesh-registry.json
docker compose exec -T coord curl -fsS http://127.0.0.1:9002/topology
```

Say:

> The terminal confirms the same route from Docker logs, the registry, and AXL
> topology. The automated smoke test checks the same path in mock LLM mode.

## Beat 6 — close (10s)

Return to the UI.

> Peerlane is a workspace for verifiable peer-to-peer agent work: one screen,
> four AXL nodes, direct handoffs, inspectable proof.

## Q&A backup

If judges ask about failure handling:

```bash
docker compose stop verify
```

Then submit a task and show the UI surfacing `Timeout waiting for analyst` or
the blocked route. Restart with:

```bash
docker compose up -d verify
```

If judges ask for process isolation:

```bash
ps aux | grep -E "axl-node|node dist"
docker compose exec -T coord cat /data/registry/mesh-registry.json
```
