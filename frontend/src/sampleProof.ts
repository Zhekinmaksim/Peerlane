import type { CapabilityId, LogEntry, NodeId, Pipeline } from "./types";

export const SAMPLE_QUESTION =
  "Verify this crypto market claim with sources: AI inference networks will become a top infrastructure narrative in 2026.";

export const SAMPLE_PIPE: Pipeline = {
  id: "sample",
  text: SAMPLE_QUESTION,
  steps: [
    { src: "user", dst: "coord", verb: "submit", msg: SAMPLE_QUESTION, state: "ok", ts: "12:00:01.01" },
    { src: "coord", dst: "research", verb: "dispatch", msg: "gather sources", state: "ok", ts: "12:00:01.05" },
    { src: "research", dst: "verify", verb: "handoff", msg: "attach findings", state: "ok", ts: "12:00:01.18" },
    { src: "verify", dst: "analyst", verb: "handoff", msg: "verified claims", state: "ok", ts: "12:00:01.31" },
    { src: "analyst", dst: "coord", verb: "return", msg: "final risk memo", state: "ok", ts: "12:00:01.44" },
    { src: "coord", dst: "user", verb: "deliver", msg: "", state: "ok", ts: "12:00:01.45" },
  ],
};

export const SAMPLE_TOPOLOGY: Record<NodeId, {
  pubkey: string;
  online: boolean;
  capabilities: CapabilityId[];
}> = {
  coord: {
    pubkey: "cff135cfebfffaa435b77ab6e85e197ab7a9dd94f733b0c9c7c5443811f6b7e9",
    online: true,
    capabilities: ["task.entrypoint"],
  },
  research: {
    pubkey: "665ea0afb5650af6fcd5735371af5dae0cbebddb929605aa7b12f0f155744933",
    online: true,
    capabilities: ["research.market"],
  },
  verify: {
    pubkey: "c1a747e968f00f88517e172f8bf8503927d71eaee7482149cafc78a067654f2f",
    online: true,
    capabilities: ["verify.claims"],
  },
  analyst: {
    pubkey: "cba5420d60c5baf3de5e4c5861c3e8728d003b0b1db955e42698980de7db01bf",
    online: true,
    capabilities: ["analyst.synthesize"],
  },
};

export const SAMPLE_LOG: LogEntry[] = [
  { t: "12:00:01.01", src: "user", dst: "coord", type: "SND", detail: SAMPLE_QUESTION },
  {
    t: "12:00:01.03",
    src: "coord",
    dst: "research",
    type: "A2A",
    detail: "native /a2a probe status=ok",
    mid: "sample-00-native-a2a",
    protocol: "message/send",
    mcpTool: "peerlane.probe_capability",
  },
  {
    t: "12:00:01.05",
    src: "coord",
    dst: "research",
    type: "DIS",
    detail: "gather_sources",
    mid: "sample-01-coord-research",
    protocol: "message/send",
    mcpTool: "peerlane.gather_sources",
  },
  {
    t: "12:00:01.12",
    src: "research",
    dst: "coord",
    type: "GOS",
    detail: "research.gossip",
    mid: "sample-02-research-gossip",
    parentMid: "sample-01-coord-research",
    protocol: "message/send",
    mcpTool: "peerlane.gather_sources",
  },
  {
    t: "12:00:01.18",
    src: "research",
    dst: "verify",
    type: "DIS",
    detail: "cross_reference",
    mid: "sample-03-research-verify",
    parentMid: "sample-01-coord-research",
    protocol: "message/send",
    mcpTool: "peerlane.cross_reference",
  },
  {
    t: "12:00:01.24",
    src: "verify",
    dst: "research",
    type: "CLA",
    detail: "clarify_evidence",
    mid: "sample-04-verify-research",
    parentMid: "sample-03-research-verify",
    protocol: "message/send",
    mcpTool: "peerlane.clarify_evidence",
  },
  {
    t: "12:00:01.28",
    src: "research",
    dst: "verify",
    type: "CLA",
    detail: "clarify_response",
    mid: "sample-05-research-verify",
    parentMid: "sample-04-verify-research",
    protocol: "message/send",
    mcpTool: "peerlane.clarify_response",
  },
  {
    t: "12:00:01.31",
    src: "verify",
    dst: "analyst",
    type: "DIS",
    detail: "synthesize",
    mid: "sample-06-verify-analyst",
    parentMid: "sample-03-research-verify",
    protocol: "message/send",
    mcpTool: "peerlane.synthesize_report",
  },
  {
    t: "12:00:01.44",
    src: "analyst",
    dst: "coord",
    type: "RET",
    detail: "analyst.result",
    mid: "sample-07-analyst-coord",
    parentMid: "sample-06-verify-analyst",
    protocol: "message/send",
    mcpTool: "peerlane.synthesize_report",
  },
];

export const SAMPLE_CONTRIBS: Partial<Record<NodeId, string>> = {
  research:
    "Research found repeated public signals around decentralized inference, GPU supply constraints, and AI x crypto infrastructure demand. Sources include protocol docs, public market reports, and ecosystem announcements.",
  verify:
    "Verifier cross-checked the strongest claims and requested one clarification from research. The direction of demand is well supported; exact market sizing remains medium confidence.",
  analyst:
    "The claim is directionally credible: decentralized AI inference is likely to remain a major infrastructure narrative in 2026. Confidence is high for narrative momentum and medium for exact market size.",
};

export const SAMPLE_RESULT = [
  "The claim is directionally credible. Decentralized AI inference is likely to remain a major crypto infrastructure narrative in 2026, driven by demand for verifiable compute, GPU scarcity, and interest in open AI networks.",
  "",
  "The strongest evidence supports narrative momentum rather than a precise market size. The verifier flagged exact revenue estimates as medium confidence and asked research to clarify source quality before analyst synthesis.",
  "",
  "Confidence: 0.84. Sources should be reviewed again before using this as an investment decision.",
].join("\n");

export const SAMPLE_CONFIDENCE = 0.84;
