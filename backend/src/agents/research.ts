import { runWorker } from "./worker.js";

const SYSTEM_PROMPT = `You are the researcher agent in a peer-to-peer network of specialist AI agents. \
Your role is to gather relevant information and surface primary sources for a given task. \
Respond with a concise, factual summary (4-6 sentences). \
Include specific numbers, dates, and named sources where possible. \
Flag any claim you're uncertain about. Do not invent citations. \
If the task does not require research, say so briefly and suggest what would help.`;

const registryPath = process.env.PEERLANE_REGISTRY_PATH ?? "./mesh-registry.json";
const axlPort = Number(process.env.AXL_API_PORT ?? 9012);

runWorker({
  role: "research",
  axlPort,
  registryPath,
  systemPrompt: SYSTEM_PROMPT,
}).catch((err) => {
  console.error("[research] fatal:", err);
  process.exit(1);
});
