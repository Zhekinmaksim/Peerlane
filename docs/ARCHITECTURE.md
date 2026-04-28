# Architecture

## Mesh topology

```mermaid
flowchart LR
    subgraph browser [Browser]
        UI[Peerlane UI<br/>Vite + React]
    end

    subgraph coord_host [coord container]
        coord_agent[Coordinator agent<br/>Node.js]
        coord_axl[AXL node<br/>:9002 HTTP / :7001 TLS]
        coord_agent <-->|localhost HTTP| coord_axl
    end

    subgraph research_host [research container]
        research_agent[Researcher agent]
        research_axl[AXL node<br/>:9012]
        research_agent <-->|localhost HTTP| research_axl
    end

    subgraph verify_host [verify container]
        verify_agent[Verifier agent]
        verify_axl[AXL node<br/>:9022]
        verify_agent <-->|localhost HTTP| verify_axl
    end

    subgraph analyst_host [analyst container]
        analyst_agent[Analyst agent]
        analyst_axl[AXL node<br/>:9032]
        analyst_agent <-->|localhost HTTP| analyst_axl
    end

    UI <-->|HTTP + WebSocket| coord_agent

    coord_axl <-->|Yggdrasil mesh<br/>E2E encrypted| research_axl
    research_axl <-->|Yggdrasil mesh<br/>E2E encrypted| verify_axl
    verify_axl <-->|Yggdrasil mesh<br/>E2E encrypted| analyst_axl
    analyst_axl <-->|Yggdrasil mesh<br/>E2E encrypted| coord_axl
```

## Task flow

```mermaid
sequenceDiagram
    participant UI
    participant Coord as Coord agent
    participant CAXL as Coord AXL
    participant RAXL as Research AXL
    participant VAXL as Verify AXL
    participant AAXL as Analyst AXL

    UI->>Coord: POST /task { question }
    Coord->>UI: WS task_started

    Note over Coord,AAXL: Coord starts the route; workers hand off directly
    Coord->>CAXL: POST /send (DISPATCH → research)
    CAXL->>RAXL: Yggdrasil peer msg
    RAXL-->>Research agent: GET /recv

    Research agent->>RAXL: POST /send (DISPATCH → verify)<br/>with research findings
    RAXL->>VAXL: Yggdrasil peer msg
    VAXL-->>Verify agent: GET /recv

    Verify agent->>VAXL: POST /send (CLARIFY → research)
    VAXL->>RAXL: Yggdrasil peer msg
    RAXL-->>Research agent: GET /recv
    Research agent->>RAXL: POST /send (CLARIFY_RESPONSE → verify)
    RAXL->>VAXL: Yggdrasil peer msg
    VAXL-->>Verify agent: GET /recv

    Verify agent->>VAXL: POST /send (DISPATCH → analyst)<br/>with verified findings
    VAXL->>AAXL: Yggdrasil peer msg
    AAXL-->>Analyst agent: GET /recv

    Analyst agent->>AAXL: POST /send (RETURN → coord)
    AAXL->>CAXL: Yggdrasil peer msg
    CAXL->>Coord: GET /recv

    Coord->>UI: WS contribution + step_update
    Coord->>UI: WS task_complete
```

## Discovery and routing

Every process writes an inspectable peer record to the shared registry after its
AXL node is ready. The record contains:

- AXL public key
- local AXL API port
- advertised capabilities
- an A2A-style Agent Card

Coord does not hardcode peer pubkeys. For each task it selects peers by
capability:

| Capability | Selected role | Verb |
| :--- | :--- | :--- |
| `research.market` | `research` | `gather_sources` |
| `verify.claims` | `verify` | `cross_reference` |
| `analyst.synthesize` | `analyst` | `synthesize` |

That gives the demo a simple "Agent Town" pattern: agents advertise what they
can do, and the route is built from the live registry.

## A2A/MCP over AXL

AXL remains the only inter-agent transport. Peerlane treats AXL as a custom
A2A binding:

```text
AXL /send + /recv
  └── PeerlaneMessage
        └── protocol.binding = https://peerlane.local/bindings/axl-a2a/v1
        └── protocol.a2a.operation = message/send
        └── protocol.mcp.toolName = peerlane.gather_sources | ...
```

This is intentionally lightweight. It does not replace AXL with HTTP A2A; it
adds structured agent-to-agent semantics inside the bytes AXL carries.

Workers also emit `GOSSIP` messages after each step. These broadcasts carry the
intermediate result and MCP tool metadata to other peers, while the main route
continues peer-to-peer.

Before the main route starts, coord sends a native AXL `/a2a/{peer_id}` probe to
the selected research peer. Research hosts a minimal A2A JSON-RPC endpoint on
its side of the AXL bridge, so the project demonstrates both:

- raw AXL `/send` + `/recv` for inspectable task routing; and
- AXL's native A2A bridge for a protocol-level capability probe.

The A2A probe is intentionally non-blocking for user value: if a future AXL
environment does not expose `/a2a`, the raw AXL workflow can still run.

## Message envelope

Every AXL payload in Peerlane is a JSON-encoded `PeerlaneMessage`:

```ts
interface PeerlaneMessage {
  v: 1;
  mid: string;              // unique message id
  taskId: string;           // groups all messages for one user task
  parentMid?: string;       // reply chain
  from: NodeId;             // "coord" | "research" | "verify" | "analyst"
  to: NodeId;
  type: "DISPATCH" | "RETURN" | "CLARIFY" | "CLARIFY_RESPONSE" | "ACK" | "GOSSIP" | "ERROR";
  verb: string;             // e.g. "gather_sources", "cross_reference"
  payload: unknown;         // shape depends on type
  protocol?: {
    binding: string;         // custom AXL/A2A binding URI
    a2a: {
      protocol: "a2a";
      version: "1.0";
      operation: "message/send";
      message: {
        role: "ROLE_USER" | "ROLE_AGENT";
        parts: Array<{ text: string }>;
        messageId: string;
        taskId: string;
        contextId: string;
        metadata: Record<string, unknown>;
      };
    };
    mcp?: {
      protocol: "mcp";
      toolName: string;
      arguments: Record<string, unknown>;
    };
  };
  ts: string;               // ISO timestamp
}
```

The AXL node itself doesn't care — it ships bytes. We own the schema.

## Why these decisions

**File-based peer registry.** AXL has no pubkey discovery:
> "There is no way to look up another node's key from the network.
>  Keys MUST be exchanged directly between people."

For a demo, the simplest out-of-band channel is a shared JSON file on a
volume. On startup each agent writes its own `{role → pubkey}`, then
blocks until all four roles have written. This takes ~1s and produces
an inspectable manifest.

**Coord-as-HTTP-gateway, not broker.** The coordinator agent terminates
the frontend's HTTP+WS connection and starts the route, but it does not
orchestrate each worker step. Research forwards directly to verify; verify
forwards directly to analyst; analyst returns directly to coord.

**Capability route, not pubkey route.** Research -> verify -> analyst remains
the current workflow shape, but coord selects the concrete nodes by capability
from the registry. The route is carried inside the AXL payload so every worker
knows only its next peer, not the whole orchestration state.
