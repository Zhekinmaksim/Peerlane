# Peerlane

A single-screen peer-to-peer workspace where specialist AI agents collaborate
across separate [AXL](https://docs.gensyn.ai/tech/agent-exchange-layer) nodes
to complete real user tasks — without a central broker.

Built for the [Gensyn AXL prize](https://ethglobal.com/events/openagents/prizes/gensyn)
at ETHGlobal Open Agents.

---

## What it does

You submit one task from the UI. The coordinator starts the route, then
the workers hand the task to each other directly over AXL:

`coord -> research -> verify -> analyst -> coord`

The UI shows cross-node execution, the final synthesized result, and a
trace of the peer-to-peer messages used to complete the task.

Four agents:

| Role        | What it does                                            | AXL port |
| :---------- | :------------------------------------------------------ | :------- |
| `coord`     | Accepts user tasks; starts the route; returns results   | `9002`   |
| `research`  | Gathers facts and primary sources                       | `9012`   |
| `verify`    | Cross-references claims; flags low-confidence data      | `9022`   |
| `analyst`   | Synthesizes verified findings into a final report       | `9032`   |

Each role is a **separate OS process** running its own AXL node binary and
its own Node.js agent. Worker-to-worker handoffs go over the AXL mesh —
no shared in-process state, no centralized message bus, and no coordinator
proxy for the research -> verify -> analyst path.

---

## Requirements

- **Docker + Compose** (recommended for the cleanest demo), OR
- **Node.js 20+**, **Go 1.25.5+**, **OpenSSL 3+** for running locally
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

**1. Inspect the registry.** Each agent's AXL public key is independent
and self-generated:
```bash
cat mesh-registry.json
```

**2. Inspect AXL's own `/topology` endpoint.** Each agent runs its own:
```bash
curl -s http://127.0.0.1:9002/topology | jq .   # coord
curl -s http://127.0.0.1:9012/topology | jq .   # research
```
Each returns a different `our_public_key`.

**3. Watch the trace.** The UI's trace drawer shows the route:
`coord -> research`, `research -> verify`, `verify -> analyst`,
`analyst -> coord`.

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
