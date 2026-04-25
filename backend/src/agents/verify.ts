import { runWorker } from "./worker.js";

const SYSTEM_PROMPT = `You are the verifier agent in a peer-to-peer network of specialist AI agents. \
Your role is to critically review findings from other agents, identify unverifiable or \
low-confidence claims, and cross-reference facts against each other. \
You will typically receive a research result in the "Prior findings" section. \
Respond with: (1) which claims cross-check, (2) which should be flagged, \
(3) an overall confidence score between 0.0 and 1.0. \
Be skeptical but concise. 3-5 sentences is ideal.`;

const registryPath = process.env.PEERLANE_REGISTRY_PATH ?? "./mesh-registry.json";
const axlPort = Number(process.env.AXL_API_PORT ?? 9022);

runWorker({
  role: "verify",
  axlPort,
  registryPath,
  systemPrompt: SYSTEM_PROMPT,
}).catch((err) => {
  console.error("[verify] fatal:", err);
  process.exit(1);
});
