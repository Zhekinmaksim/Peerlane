# Demo video script with English subtitles

Target length: 2:55-3:00.
Format: 16:9 screen recording, browser first, terminal proof near the end.
Start state: `docker compose up` is already running, UI is open at
`http://localhost:5173`, connection badge says `live mesh`, view mode is `demo`.

ETHGlobal requires a 2-4 minute demo video. Keep this recording close to three
minutes so it has enough proof without risking the four-minute cutoff.

## Recording plan

| Time | Screen action | English subtitle / voiceover |
| :--- | :--- | :--- |
| 00:00-00:20 | Show full UI in Demo mode. Point at the four node badges. | Most multi-agent demos are still centralized. Peerlane shows four AI agents completing one task across four separate Gensyn AXL nodes, with no central worker broker. |
| 00:20-00:45 | Point at `coord`, `research`, `verify`, `analyst`, then the route text. | Each role is its own process, its own AXL node, its own public key, and its own capability card. Coord receives the user task, but workers hand off directly. |
| 00:45-01:25 | Click `Protocol DD` or `Token claim`, then click `run`. | We submit a due-diligence task. Coord discovers the research capability, probes research through AXL's native A2A bridge, and sends the first AXL message. |
| 01:25-02:05 | Let the Mesh timeline move. Point at live rows as they change. | Research gossips progress, forwards directly to verify, verify asks research for clarification directly, and then verify hands verified claims to analyst. |
| 02:05-02:30 | Point at Output and open `agent breakdown`. | Analyst returns the final report to coord. The output includes separate research, verification, and synthesis contributions, so the answer is inspectable. |
| 02:30-02:50 | Switch to Proof mode and expand trace. Point at MCP tool, message id, pubkeys, gossip count. | Proof mode shows real AXL traffic: sender, receiver, message ids, parent ids, MCP tool intent, Agent Cards, capabilities, gossip, and distinct AXL pubkeys. |
| 02:50-02:58 | Show terminal with one log command and one registry/topology command. | Judges can verify the same route from Docker logs, the registry, AXL topology, and the smoke test. |
| 02:58-03:00 | Return to full UI. | One screen. Four AXL nodes. Direct handoffs. Copyable proof. |

If the recording runs long, cut the terminal section to one log command and one
registry command. Do not speed up the video.

## Terminal proof commands

```bash
docker compose logs --no-color coord research verify analyst | rg 'NATIVE_A2A|DISPATCH|FORWARD|CLARIFY|GOSSIP|RETURN'
docker compose exec -T coord cat /data/registry/mesh-registry.json
docker compose exec -T coord curl -fsS http://127.0.0.1:9002/topology
PEERLANE_MOCK_LLM=1 ./scripts/smoke-test.sh
```

## SRT subtitles

```srt
1
00:00:00,000 --> 00:00:10,000
Most multi-agent demos are still centralized.
Peerlane shows peer-to-peer AI work over Gensyn AXL.

2
00:00:10,000 --> 00:00:20,000
Four agents complete one task across four separate AXL nodes,
with no central worker broker.

3
00:00:20,000 --> 00:00:32,000
Coord, research, verify, and analyst are separate processes,
separate AXL nodes, and separate public keys.

4
00:00:32,000 --> 00:00:45,000
Each node advertises an Agent Card and a capability.
Coord chooses peers from the registry.

5
00:00:45,000 --> 00:00:58,000
We submit a due-diligence task.
Coord first probes research through AXL's native A2A bridge.

6
00:00:58,000 --> 00:01:12,000
Then coord sends the first message through AXL.
After that, the worker path is direct.

7
00:01:12,000 --> 00:01:25,000
Research gathers context and broadcasts a gossip update
so the mesh can observe intermediate progress.

8
00:01:25,000 --> 00:01:38,000
Research forwards directly to verify over AXL.
The coordinator is observing, not brokering the worker handoff.

9
00:01:38,000 --> 00:01:50,000
Verify checks the claims and can negotiate with research directly
when evidence quality needs clarification.

10
00:01:50,000 --> 00:02:02,000
Research answers the clarification over AXL.
Verify then forwards the verified claims to analyst.

11
00:02:02,000 --> 00:02:15,000
Analyst synthesizes the final report
and returns it to coord after the worker chain completes.

12
00:02:15,000 --> 00:02:28,000
The output is inspectable.
Research, verification, and synthesis contributions are visible.

13
00:02:28,000 --> 00:02:42,000
Now Proof mode shows the underlying route:
message ids, parent ids, senders, receivers, and timestamps.

14
00:02:42,000 --> 00:02:52,000
The proof also includes MCP tool intent,
Agent Cards, advertised capabilities, gossip, and AXL pubkeys.

15
00:02:52,000 --> 00:02:58,000
The terminal confirms the same run from Docker logs,
the peer registry, AXL topology, and the smoke test.

16
00:02:58,000 --> 00:03:00,000
This is verifiable peer-to-peer agent work:
one screen, four AXL nodes, direct handoffs, and copyable proof.
```

## Upload description

Peerlane is an AXL-native workspace for verifiable peer-to-peer AI work.

A user submits one due-diligence task. Coord receives it, but does not centrally
orchestrate every worker step. Four independent AXL nodes — coord, research,
verify, and analyst — exchange task messages directly through AXL `/send` and
`/recv`.

Research gathers source-backed context, Verify cross-checks claims and can ask
Research for clarification directly, then Analyst synthesizes the final report
and returns it to Coord. The UI includes a Proof mode showing node pubkeys,
advertised capabilities, A2A Agent Cards, MCP-style tool intent, message ids,
gossip count, and a copyable verification bundle.

The project demonstrates meaningful AXL usage across separate nodes: each role
has its own process, AXL node, public key, and capability card. Judges can
verify the route from the UI, Docker logs, AXL topology, registry state, and
the smoke test.
