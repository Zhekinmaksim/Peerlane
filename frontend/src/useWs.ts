import { useEffect, useRef, useState } from "react";
import type { WsEvent } from "./types";

/**
 * Subscribe to the coordinator's WebSocket feed.
 * Auto-reconnects with exponential backoff on disconnect.
 */
export function useWs(onEvent: (ev: WsEvent) => void): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  // Keep the latest handler without re-opening the socket on every render.
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${location.host}/ws`;
      ws = new WebSocket(url);

      ws.onopen = () => {
        setConnected(true);
        retry = 0;
      };

      ws.onmessage = (ev) => {
        try {
          const parsed = JSON.parse(ev.data) as WsEvent;
          handlerRef.current(parsed);
        } catch {
          // Malformed frame — ignore silently.
        }
      };

      ws.onerror = () => {
        // Error will typically be followed by close; don't act here.
      };

      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        // Backoff: 500ms, 1s, 2s, 4s, capped at 5s.
        const delay = Math.min(500 * 2 ** retry, 5_000);
        retry += 1;
        timer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, []);

  return { connected };
}

/** POST a task to the coord HTTP API. Errors surface to caller. */
export async function postTask(question: string): Promise<void> {
  const res = await fetch("/task", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`POST /task failed: ${res.status} ${txt}`);
  }
}
