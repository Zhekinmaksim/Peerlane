/**
 * WebSocket hub.
 *
 * Accepts upgrades on /ws and broadcasts WsEvent messages to all clients.
 * Each new client receives an optional greeting event (current topology).
 */

import type { Server, IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { WsEvent } from "../types/messages.js";

export class WsHub {
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private greeting: (() => WsEvent | null) | null = null;

  setGreeting(fn: () => WsEvent | null): void {
    this.greeting = fn;
  }

  attach(server: Server): void {
    this.wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req: IncomingMessage, socket, head) => {
      if (req.url?.split("?")[0] === "/ws") {
        this.wss!.handleUpgrade(req, socket, head, (ws) => {
          this.onConnection(ws);
        });
      } else {
        socket.destroy();
      }
    });
  }

  private onConnection(ws: WebSocket): void {
    this.clients.add(ws);
    if (this.greeting) {
      const g = this.greeting();
      if (g) ws.send(JSON.stringify(g));
    }
    ws.on("close", () => this.clients.delete(ws));
    ws.on("error", () => this.clients.delete(ws));
  }

  broadcast(event: WsEvent): void {
    const payload = JSON.stringify(event);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }
}
