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
    coord_axl <-->|Yggdrasil mesh<br/>E2E encrypted| verify_axl
    coord_axl <-->|Yggdrasil mesh<br/>E2E encrypted| analyst_axl
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

    Note over Coord,AAXL: Research first — only depends on the question
    Coord->>CAXL: POST /send (DISPATCH → research)
    CAXL->>RAXL: Yggdrasil peer msg
    RAXL-->>Research agent: GET /recv
    Research agent->>RAXL: POST /send (RETURN → coord)
    RAXL->>CAXL: Yggdrasil peer msg
    CAXL->>Coord: GET /recv
    Coord->>UI: WS contribution + step_update

    Note over Coord,AAXL: Verify cross-references the research result
    Coord->>CAXL: POST /send (DISPATCH → verify)<br/>with research findings
    CAXL->>VAXL: Yggdrasil peer msg
    VAXL-->>Verify agent: GET /recv
    Verify agent->>VAXL: POST /send (RETURN → coord)
    VAXL->>CAXL: Yggdrasil peer msg
    CAXL->>Coord: GET /recv
    Coord->>UI: WS contribution + step_update

    Note over Coord,AAXL: Analyst synthesizes verified findings
    Coord->>CAXL: POST /send (DISPATCH → analyst)<br/>with research + verify findings
    CAXL->>AAXL: Yggdrasil peer msg
    AAXL-->>Analyst agent: GET /recv
    Analyst agent->>AAXL: POST /send (RETURN → coord)
    AAXL->>CAXL: Yggdrasil peer msg
    CAXL->>Coord: GET /recv

    Coord->>UI: WS task_complete
```

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
  type: "DISPATCH" | "RETURN" | "ACK" | "ERROR";
  verb: string;             // e.g. "gather_sources", "cross_reference"
  payload: unknown;         // shape depends on type
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
the frontend's HTTP+WS connection, but all agent-to-agent traffic goes
over AXL. The coordinator doesn't proxy, route, or mediate messages
between workers. If the verifier wanted to message the analyst directly,
it could — the mesh allows it.

**Sequential dependency chain.** Research → verify → analyst. Verify
needs research findings to cross-check; analyst needs both to synthesize
a report. The UI timeline makes the chain visible — each step's active
row glows amber as its AXL round-trip is in flight.
