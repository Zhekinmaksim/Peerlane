# Demo video script with English subtitles

Target length: 90 seconds.
Format: screen recording, 16:9, browser + optional terminal.
Start state: `docker compose up` is already running, UI is open at
`http://localhost:5173`, connection badge is green, view mode is `demo`.

## Recording plan

| Time | Screen action | English subtitle / voiceover |
| :--- | :--- | :--- |
| 00:00-00:07 | Show full UI in Demo mode. Point at header and four nodes. | Peerlane is a peer-to-peer workspace for AI agents. Four specialists run as four separate AXL nodes. |
| 00:07-00:14 | Hover or point across `coord`, `research`, `verify`, `analyst`. | The coordinator accepts the user task, but it does not orchestrate every worker step. |
| 00:14-00:21 | Click the `Token claim` preset. | For this demo, we ask the network to verify a crypto market claim with multiple agents. |
| 00:21-00:27 | Click `run`. | Before the route starts, coord probes research through AXL's native A2A bridge. Then it sends the first AXL message. |
| 00:27-00:39 | Let Mesh timeline run. Point at `research -> verify`, `verify -> research`, and `verify -> analyst`. | Research forwards directly to verify. Verify asks research for clarification directly, then forwards to analyst. |
| 00:39-00:48 | Point at Output panel as result appears. | The worker path is peer-to-peer, and the analyst returns the final answer to coord after using verified findings. |
| 00:48-00:55 | Click `agent breakdown`. | Each agent contribution is visible, so the final answer is not a black box. |
| 00:55-01:02 | Switch to `proof` mode. | Now we switch to Proof mode to show that this is real AXL traffic, not a UI animation. |
| 01:02-01:14 | Open trace footer. Point at route, message rows, MCP tool column. | Every row is an AXL message with sender, receiver, verb, timestamp, message id, and MCP-style tool intent. |
| 01:14-01:23 | Point at node identity/capability panel and gossip count. | Each peer advertises an A2A-style Agent Card, capabilities, and a unique AXL public key. Workers also gossip intermediate results to the mesh. |
| 01:23-01:30 | Click `copy proof`, optionally flash terminal logs if available. | Judges can verify the same route from the UI proof panel, Docker logs, registry, AXL topology, and the smoke test. |
| 01:30-01:35 | Return to full UI or final output. | One screen. Four real AXL nodes. Dynamic capability routing. Peer-to-peer agent work. Peerlane. |

If the platform requires exactly 90 seconds, cut the final line at 01:30.

## SRT subtitles

```srt
1
00:00:00,000 --> 00:00:07,000
Peerlane is a peer-to-peer workspace for AI agents.
Four specialists run as four separate AXL nodes.

2
00:00:07,000 --> 00:00:14,000
The coordinator accepts the user task,
but it does not orchestrate every worker step.

3
00:00:14,000 --> 00:00:21,000
For this demo, we ask the network
to verify a crypto market claim with multiple agents.

4
00:00:21,000 --> 00:00:27,000
The task enters the mesh.
Coord first probes research through AXL's native A2A bridge.

5
00:00:27,000 --> 00:00:34,000
Then research forwards directly to verify through AXL.
Verify asks research for clarification directly.

6
00:00:34,000 --> 00:00:39,000
Verify forwards directly to analyst through AXL.
The worker path is peer-to-peer.

7
00:00:39,000 --> 00:00:48,000
The analyst returns the final answer to coord
after using verified findings, not raw research alone.

8
00:00:48,000 --> 00:00:55,000
Each agent contribution is visible,
so the final answer is not a black box.

9
00:00:55,000 --> 00:01:02,000
Now we switch to Proof mode
to show that this is real AXL traffic.

10
00:01:02,000 --> 00:01:09,000
Every row is an AXL message with sender,
receiver, verb, timestamp, and message id.

11
00:01:09,000 --> 00:01:14,000
The MCP tool column shows the structured intent
inside the A2A-style payload.

12
00:01:14,000 --> 00:01:20,000
Each peer advertises an Agent Card,
capabilities, and a unique AXL public key.

13
00:01:20,000 --> 00:01:23,000
Workers also gossip intermediate results to the mesh.

14
00:01:23,000 --> 00:01:30,000
Judges can verify the same route from the UI,
Docker logs, registry, AXL topology, and smoke test.

15
00:01:30,000 --> 00:01:35,000
One screen. Four real AXL nodes.
Dynamic capability routing. Peerlane.
```

## Upload description

Peerlane runs four independent Gensyn AXL nodes: coord, research, verify, and
analyst. Coord accepts the user task and dynamically selects peers by advertised
capabilities. Workers then hand off directly over AXL: coord -> research ->
verify -> analyst -> coord. Coord also performs a native AXL `/a2a/{peer}` probe
against research before the raw AXL route starts, and verify can ask research
for clarification directly over AXL. Messages carry A2A-style `message/send`
payloads and MCP-style tool metadata, and workers gossip intermediate results
to peers. The UI includes a Proof mode with pubkeys, capabilities, message ids,
gossip count, and a copyable verification bundle. The hosted Vercel frontend
includes a sample proof button; the full four-node proof is recorded locally.
