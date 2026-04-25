/**
 * AXL client — HTTP bridge to a local AXL node.
 *
 * Each AXL node exposes a local HTTP server (default :9002). We use:
 *   - GET  /topology    → our public key, IPv6, known peers
 *   - POST /send        → fire-and-forget message to a peer
 *   - GET  /recv        → poll for inbound messages
 *
 * AXL is application-agnostic: it moves bytes. We put a PeerlaneMessage
 * envelope inside, with an A2A 1.0-style message/send payload and MCP-style
 * tool metadata under `message.protocol`.
 *
 * Reference: https://docs.gensyn.ai/tech/agent-exchange-layer
 */

import type { PeerlaneMessage } from "../types/messages.js";

export interface AxlTopology {
  our_ipv6: string;
  our_public_key: string;
  peers?: unknown[];
  tree?: unknown[];
}

export class AxlClient {
  private readonly baseUrl: string;

  constructor(apiPort: number) {
    this.baseUrl = `http://127.0.0.1:${apiPort}`;
  }

  /** Our node's identity + mesh state. */
  async topology(): Promise<AxlTopology> {
    const res = await fetch(`${this.baseUrl}/topology`);
    if (!res.ok) throw new Error(`AXL /topology failed: ${res.status}`);
    return res.json() as Promise<AxlTopology>;
  }

  /** Get our public key (= our address on the mesh). */
  async publicKey(): Promise<string> {
    const t = await this.topology();
    return t.our_public_key;
  }

  /**
   * Send a message to a peer identified by its hex-encoded public key.
   * The message body is a JSON-encoded PeerlaneMessage.
   */
  async send(peerPubkey: string, message: PeerlaneMessage): Promise<void> {
    const body = JSON.stringify(message);
    const res = await fetch(`${this.baseUrl}/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Destination-Peer-Id": peerPubkey,
      },
      body,
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`AXL /send failed: ${res.status} ${err}`);
    }
  }

  /**
   * Long-polls /recv for one inbound message.
   * Returns null on 204 (no message). Throws on other errors.
   *
   * The `X-From-Peer-Id` header tells us who sent it.
   */
  async recv(timeoutMs = 25_000): Promise<{ from: string; message: PeerlaneMessage } | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/recv`, { signal: controller.signal });
      if (res.status === 204) return null;
      if (!res.ok) throw new Error(`AXL /recv failed: ${res.status}`);
      const from = res.headers.get("X-From-Peer-Id") ?? "";
      const text = await res.text();
      let parsed: PeerlaneMessage;
      try {
        parsed = JSON.parse(text) as PeerlaneMessage;
      } catch {
        throw new Error("AXL /recv returned non-JSON body");
      }
      return { from, message: parsed };
    } catch (err) {
      if ((err as Error).name === "AbortError") return null;
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Continuously poll an AXL node's /recv and invoke a handler per message.
 * Exits when the abort signal fires.
 */
export async function pollRecv(
  client: AxlClient,
  onMessage: (from: string, msg: PeerlaneMessage) => Promise<void> | void,
  onError: (err: Error) => void,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    try {
      const got = await client.recv(20_000);
      if (!got) continue;
      await onMessage(got.from, got.message);
    } catch (err) {
      if (signal.aborted) return;
      onError(err as Error);
      // brief backoff so we don't hot-loop on a persistent error
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
}
