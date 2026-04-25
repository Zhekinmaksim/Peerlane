# AI usage and attribution

Peerlane was built as an AI-assisted hackathon project. This file documents how
AI tools were used, what remained under human ownership, and how the final build
was planned and verified.

## Tools used

- OpenAI Codex was used as the main coding assistant inside the local project
  workspace.
- Claude was used for additional ideation, implementation review, and copy
  refinement during the project.

## AI-assisted work

AI tools helped with:

- Generating and refining TypeScript backend code for the coordinator, workers,
  AXL client wrapper, registry handling, and WebSocket events.
- Generating and refining the React/Vite frontend, including the live topology,
  event trace, task form, and contribution panels.
- Drafting the visual design direction and improving the demo-facing UI copy.
- Writing and improving README content, architecture notes, demo instructions,
  and submission-oriented documentation.
- Creating Docker and Docker Compose setup for four separate AXL-backed agent
  processes plus the frontend.
- Writing smoke-test scripts that verify the required task flow, Docker logs,
  registry state, and AXL topology.
- Reviewing implementation risks and suggesting fixes while debugging local
  build and Docker issues.

## Human-owned decisions

The project owner retained responsibility for:

- Selecting the Gensyn AXL hackathon target and defining the Peerlane concept.
- Choosing the final architecture and demo narrative.
- Deciding to strengthen the mesh from a coordinator-led workflow into a direct
  AXL handoff chain:

  ```text
  coord -> research -> verify -> analyst -> coord
  ```

- Deciding what belongs in the submission and what should stay out.
- Running and accepting the local verification results before submission.
- Owning the final repository, Docker build, smoke test, demo, and hackathon
  submission.

## Spec-driven planning note

The work was planned around the hackathon's core requirement: demonstrate agents
communicating through Gensyn AXL rather than only presenting a conventional app.

The resulting implementation focuses on a visible multi-agent workflow:

- `coord` receives the user task and starts the route.
- `research` receives the first AXL `DISPATCH`.
- `research` forwards directly to `verify` through AXL.
- `verify` forwards directly to `analyst` through AXL.
- `analyst` returns the final result to `coord` through AXL.
- The UI subscribes to live events and renders topology, message trace,
  per-agent contributions, and final completion.

This keeps the coordinator as a user-facing gateway rather than the central
orchestrator for every worker step.

## Verification log

The final local smoke test was run with Docker Compose in mock LLM mode:

```bash
env -u ANTHROPIC_API_KEY ./scripts/smoke-test.sh
```

The test verifies:

- `coord` healthcheck becomes healthy.
- `http://localhost:5173` serves the UI.
- A submitted task produces `task_started`, `message`, `contribution`, and
  `task_complete` events.
- The shared registry contains four peers: `coord`, `research`, `verify`, and
  `analyst`.
- Docker logs show direct worker handoffs:

  ```text
  coord -> research
  research -> verify
  verify -> analyst
  analyst -> coord
  ```

The final submission should be evaluated from the repository contents and the
Docker Compose smoke-test path described above.
