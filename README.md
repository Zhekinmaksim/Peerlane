# Peerlane

A single-screen peer-to-peer workspace where specialist AI agents collaborate
across separate [AXL](https://docs.gensyn.ai/tech/agent-exchange-layer) nodes
to complete real user tasks — without a central broker.

Built for the [Gensyn AXL prize](https://ethglobal.com/events/openagents/prizes/gensyn)
at ETHGlobal Open Agents.

---

## What it does

You submit one task from the UI. The coordinator discovers worker capabilities
from the peer registry, starts the route, then the workers hand the task to each
other directly over AXL:

`coord -> research -> verify -> analyst -> coord`

In plain terms: Peerlane runs four independent AXL nodes. The coordinator
only accepts the browser task and starts the first message; the workers pass
the task directly to each other through AXL.

The UI shows cross-node execution, the final synthesized result, and a
trace of the peer-to-peer messages used to complete the task.

The frontend has two modes:
- **Demo** keeps the screen focused on the task, route, agent work, and final
  result.
- **Proof** exposes pubkeys, capabilities, MCP tool names, message ids, gossip
  count, and the copyable verification bundle.

Preset prompts cover crypto/security review, token-claim verification, and
protocol due diligence so judges can start a realistic task without inventing
one live.

Peerlane uses AXL as a custom Agent2Agent-style binding: every inter-agent
message still travels through AXL `/send` and `/recv`, but the application
payload includes an A2A `message/send` structure plus MCP-style tool metadata.
Each peer also advertises an A2A-style Agent Card with skills/capabilities in
the registry.

Four agents:

| Role        | Capability           | What it does                                      | AXL port |
| :---------- | :------------------- | :------------------------------------------------ | :------- |
| `coord`     | `task.entrypoint`    | Accepts user tasks; selects peers by capability   | `9002`   |
| `research`  | `research.market`    | Gathers facts and primary sources                 | `9012`   |
| `verify`    | `verify.claims`      | Cross-references claims; flags low-confidence data | `9022`   |
| `analyst`   | `analyst.synthesize` | Synthesizes verified findings into a final report | `9032`   |

Each role is a **separate OS process** running its own AXL node binary and
its own Node.js agent. Worker-to-worker handoffs go over the AXL mesh —
no shared in-process state, no centralized message bus, and no coordinator
proxy for the research -> verify -> analyst path.

After each worker step, the agent also sends a lightweight `GOSSIP` broadcast
with its intermediate result to the rest of the mesh. This makes intermediate
state visible without handing orchestration back to the coordinator.

---

## Requirements

- **Docker + Compose** (recommended for the cleanest demo), OR
- **Node.js 20+**, **Go 1.24+ with `GOTOOLCHAIN=auto`**, **OpenSSL 3+** for running locally
- An **`ANTHROPIC_API_KEY`** — or set `PEERLANE_MOCK_LLM=1` for deterministic offline responses

---

## Quickstart (Docker)

```bash
cp .env.example .env
# edit .env and add your ANTHROPIC_API_KEY (or set PEERLANE_MOCK_LLM=1)

docker compose up --build
```

Wait ~30 seconds for the mesh to come up, then open
**http://localhost:5173**.

Each agent will log to stdout; the coord container's logs are the most
interesting. You'll see something like:

```
[12:43:21.103] [coord] AXL ready, pubkey = a1b2c3d4…
[12:43:21.104] [coord] registered in peer registry
[12:43:22.410] [coord] all peers online: coord=a1b2c3d4… research=f7e8d9c0… verify=1a2b3c4d… analyst=9f8e7d6c…
[12:43:22.411] [coord] HTTP+WS listening on :8080
```

---

## Vercel frontend preview

The Vercel deployment is intended as a public preview of the Peerlane frontend.
The full AXL mesh still runs locally through Docker Compose for the hackathon
demo video and technical verification.

Live preview:

https://www.peerlane.xyz/

Recommended Vercel settings:

```text
Root Directory: frontend
Framework Preset: Vite
Build Command: npm run build
Output Directory: dist
```

Important: the Vercel preview does not run the four AXL nodes, `/task`, `/ws`,
or the Docker mesh. For the real demo/proof, record the local flow:

```bash
colima start
env -u ANTHROPIC_API_KEY ./scripts/smoke-test.sh
docker compose up
```

Then open `http://localhost:5173`, record the UI in Demo mode, switch to Proof
mode, and show the trace/pubkeys/copy-proof panel.

---

## Quickstart (bare metal)

Use this if you want to tail logs and poke at AXL directly, or if you
don't have Docker set up.

```bash
# 1. One-time: clone and build AXL, generate identity keys
./scripts/bootstrap.sh

# 2. Install agent dependencies and build
cd backend && npm install && npm run build && cd ..

# 3. Install frontend dependencies
cd frontend && npm install && cd ..

# 4. Start the full mesh (4 AXL nodes + 4 agents)
export ANTHROPIC_API_KEY=sk-ant-...
./scripts/start-mesh.sh

# 5. In a separate terminal, run the frontend
cd frontend && npm run dev
```

Visit **http://localhost:5173**.

To stop everything: `Ctrl-C` in the `start-mesh.sh` terminal.

---

## Project layout

```
peerlane/
├── backend/
│   └── src/
│       ├── agents/          # coord, research, verify, analyst entry points
│       │   └── worker.ts    # shared worker loop
│       ├── axl/             # AXL HTTP client + peer registry
│       ├── llm/             # Anthropic wrapper with mock fallback
│       ├── types/           # message envelope + WS event types
│       └── ws/              # WebSocket hub for the frontend
├── frontend/
│   └── src/                 # Vite + React, single screen
├── scripts/
│   ├── bootstrap.sh         # clone + build AXL, generate keys
│   ├── start-mesh.sh        # launch all 4 nodes + agents
│   ├── container-entrypoint.sh
│   └── node-config-*.json   # one AXL config per role
├── docs/
│   ├── ARCHITECTURE.md      # diagrams + message schema
│   └── DEMO.md              # 90-second demo script
├── Dockerfile               # agent image (builds AXL + TS)
├── docker-compose.yml       # 4 agent containers + frontend + shared volume
└── README.md
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for diagrams and message
schemas, and [`docs/DEMO.md`](docs/DEMO.md) for the 90-second demo walkthrough.

---

## Verifying it's really peer-to-peer

Three ways to confirm that no messages are being routed through a
centralized broker:

**0. Use the UI proof panel.** Open the trace drawer after a run. It shows:
- the fixed route: `coord -> research -> verify -> analyst -> coord`
- node pubkeys from the live registry
- advertised capabilities and A2A Agent Card metadata
- every message's `from`, `to`, `type`, `verb`, timestamp, and message id
- MCP-style tool names attached to A2A message payloads
- a **copy proof** button for judges

**1. Inspect the registry.** Each agent's AXL public key is independent
and self-generated:
```bash
docker compose exec -T coord cat /data/registry/mesh-registry.json
```

**2. Inspect AXL's own `/topology` endpoint.** Each agent runs its own:
```bash
docker compose exec -T coord curl -fsS http://127.0.0.1:9002/topology
docker compose exec -T research curl -fsS http://127.0.0.1:9012/topology
```
Each returns a different `our_public_key`.

**3. Watch Docker logs for direct handoffs.** A successful run should show
coord dispatching only to research, then worker-to-worker forwards:
```bash
docker compose logs --no-color coord research verify analyst | rg 'DISPATCH|FORWARD|RETURN|inbound'
```

Expected shape:
```text
coord      DISPATCH task=... to=research verb="gather_sources"
research   FORWARD sent task=... to=verify verb="cross_reference"
verify     FORWARD sent task=... to=analyst verb="synthesize"
analyst    RETURN sent for task=...
coord      inbound RETURN from=analyst task=...
research   GOSSIP broadcast task=... peers=3
```

For an end-to-end automated proof, run:
```bash
PEERLANE_MOCK_LLM=1 ./scripts/smoke-test.sh
```

## Why this wins Gensyn

- **AXL is the transport, not a checkbox.** Four independent AXL nodes exchange
  every agent message through `/send` and `/recv`.
- **No central worker orchestrator.** Coord starts the task, then workers hand
  off directly: research -> verify -> analyst.
- **A2A/MCP-aware payloads.** Messages carry A2A `message/send` structure and
  MCP-style tool metadata while using AXL as the custom peer transport.
- **Dynamic capability routing.** Agents advertise skills in the registry;
  coord selects peers by capability instead of hardcoding pubkeys.
- **Broadcast layer.** Workers gossip intermediate results to peers, giving the
  mesh more than a single request/reply path.
- **Judge-verifiable proof.** UI proof panel, Docker logs, registry pubkeys,
  topology output, and smoke-test assertions all prove the same route.

---

## Qualification requirements

The Gensyn prize has two hard requirements:

> Must use AXL for inter-agent or inter-node communication (no centralised
> message broker replacing what AXL provides).

Every message between agents is serialized as JSON and sent through
`POST /send` on the sender's AXL node, then delivered to the recipient
via `GET /recv` on their AXL node. Research sends directly to verify;
verify sends directly to analyst; analyst sends directly back to coord.
We never proxy those handoffs through an HTTP service, a message queue,
or any other transport.

> Must demonstrate communication across separate AXL nodes, not just in-process.

Each role runs as a separate OS process with its own:
- ed25519 private key → its own AXL pubkey
- AXL node binary instance (separate process)
- AXL HTTP bridge on a distinct port
- Node.js agent process

Running `ps aux | grep -E "axl-node|node dist"` during operation will
show 8 distinct processes.

---

## License

MIT.
