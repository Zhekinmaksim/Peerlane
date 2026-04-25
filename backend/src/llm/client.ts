/**
 * LLM wrapper.
 *
 * Default: Anthropic Claude via `@anthropic-ai/sdk`, reading ANTHROPIC_API_KEY.
 * Fallback: deterministic mock for offline demos or when no key is set.
 *
 * Keeping this file small and role-agnostic — each agent passes its own
 * system prompt.
 */

import Anthropic from "@anthropic-ai/sdk";

export interface LlmCallOptions {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LlmResult {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

export async function callLlm(opts: LlmCallOptions): Promise<LlmResult> {
  // Offline mode for demos without an API key.
  if (!process.env.ANTHROPIC_API_KEY || process.env.PEERLANE_MOCK_LLM === "1") {
    return mockLlm(opts);
  }

  const response = await client().messages.create({
    model: DEFAULT_MODEL,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.4,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return {
    text,
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens,
  };
}

/** Deterministic role-aware stand-in used when no API key is set. */
function mockLlm(opts: LlmCallOptions): LlmResult {
  const s = opts.system.toLowerCase();
  const q = opts.user.slice(0, 200);

  if (s.includes("researcher")) {
    return {
      text: [
        `3 primary sources consulted for: "${q.slice(0, 60)}…"`,
        `Headline figures: market ≈ $4.2B (2025 est.), 18.7% CAGR.`,
        `Regulatory exposure in EU — two draft frameworks pending Q3.`,
        `Strongest signals: IEEE Spectrum (Mar 2026), WEF Global Risks Brief.`,
        `One third-party dataset uses non-standard taxonomy — flagged for verification.`,
      ].join(" "),
    };
  }
  if (s.includes("verifier")) {
    return {
      text: [
        `Cross-reference complete.`,
        `IEEE ↔ WEF: consistent on growth trajectory.`,
        `Third-party "47 active players" claim uses different taxonomy — flagged low confidence.`,
        `2 of 3 claims verified. Overall confidence: 0.87.`,
      ].join(" "),
    };
  }
  if (s.includes("analyst")) {
    return {
      text: [
        `Summary`,
        ``,
        `The market shows strong growth signals — estimated $4.2B (2025) at 18.7% CAGR.`,
        `Growth driven by enterprise adoption and infrastructure buildout.`,
        `Regulatory headwinds in the EU are the primary risk factor; two pending`,
        `frameworks may reshape the competitive landscape by late 2026.`,
        ``,
        `Verified claims: direction of growth (high confidence), exact market figures`,
        `(medium confidence). One data point deferred for manual review.`,
        ``,
        `Sources: IEEE Spectrum (Mar 2026), WEF Global Risks Brief.`,
        `Confidence: 0.87.`,
      ].join("\n"),
    };
  }
  return { text: `(mock LLM) received:\n${q}` };
}
