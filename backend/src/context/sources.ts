export interface SourceContext {
  summary: string;
  sources: Array<{
    name: string;
    url: string;
    status: "referenced" | "fetched" | "unavailable";
    note: string;
  }>;
}

const SOURCE_TIMEOUT_MS = 2_500;

export async function buildCryptoSourceContext(question: string): Promise<SourceContext> {
  const q = question.toLowerCase();
  const sources: SourceContext["sources"] = [
    {
      name: "DefiLlama protocols dataset",
      url: "https://api.llama.fi/protocols",
      status: "referenced",
      note: "Broad public protocol dataset useful for market and category checks.",
    },
    {
      name: "Ethereum public RPC",
      url: "https://cloudflare-eth.com",
      status: "referenced",
      note: "Public Ethereum RPC useful for basic chain liveness and block context.",
    },
  ];

  if (q.includes("contract") || q.includes("address") || q.includes("audit")) {
    sources.push({
      name: "Blockscout Ethereum explorer",
      url: "https://eth.blockscout.com",
      status: "referenced",
      note: "Explorer context for contract, transaction, and account risk review.",
    });
  }

  if (process.env.PEERLANE_SOURCE_FETCH !== "0") {
    await Promise.all([
      fetchDefiLlamaSample(sources),
      fetchEthereumBlock(sources),
    ]);
  }

  return {
    summary: [
      "Crypto/security context pack:",
      ...sources.map((source) => `- ${source.name} (${source.status}): ${source.note} ${source.url}`),
    ].join("\n"),
    sources,
  };
}

async function fetchDefiLlamaSample(sources: SourceContext["sources"]): Promise<void> {
  const source = sources.find((s) => s.name === "DefiLlama protocols dataset");
  if (!source) return;
  try {
    const data = await fetchJson<Array<{ name?: string; category?: string; tvl?: number }>>(source.url);
    const aiLike = data
      .filter((item) => /ai|compute|inference|data/i.test(`${item.name ?? ""} ${item.category ?? ""}`))
      .slice(0, 5)
      .map((item) => item.name)
      .filter(Boolean);
    source.status = "fetched";
    source.note = aiLike.length > 0
      ? `Fetched ${data.length} protocols; AI/compute-like matches include ${aiLike.join(", ")}.`
      : `Fetched ${data.length} protocols; no obvious AI/compute category match in the first pass.`;
  } catch (err) {
    source.status = "unavailable";
    source.note = `Fetch failed safely: ${(err as Error).message}`;
  }
}

async function fetchEthereumBlock(sources: SourceContext["sources"]): Promise<void> {
  const source = sources.find((s) => s.name === "Ethereum public RPC");
  if (!source) return;
  try {
    const data = await fetchJson<{ result?: string }>(source.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
    });
    const block = data.result ? Number.parseInt(data.result, 16) : NaN;
    source.status = "fetched";
    source.note = Number.isFinite(block)
      ? `Fetched current Ethereum block context: ${block}.`
      : "Fetched RPC response but block number was not parseable.";
  } catch (err) {
    source.status = "unavailable";
    source.note = `Fetch failed safely: ${(err as Error).message}`;
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json() as T;
  } finally {
    clearTimeout(timer);
  }
}
