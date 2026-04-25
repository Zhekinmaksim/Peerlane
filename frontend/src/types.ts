// Mirror of backend/src/types/messages.ts

export type NodeId = "coord" | "research" | "verify" | "analyst";

export type MessageType = "DISPATCH" | "RETURN" | "ACK" | "ERROR";

export interface PeerlaneMessage {
  v: 1;
  mid: string;
  taskId: string;
  parentMid?: string;
  from: NodeId;
  to: NodeId;
  type: MessageType;
  verb: string;
  payload: unknown;
  ts: string;
}

export type WsEvent =
  | { kind: "task_started"; taskId: string; question: string; ts: string }
  | { kind: "message"; message: PeerlaneMessage }
  | { kind: "node_busy"; node: NodeId; busy: boolean; ts: string }
  | { kind: "step_update"; taskId: string; stepIndex: number; state: "wait" | "run" | "ok" | "err"; msg?: string; ts: string }
  | { kind: "contribution"; taskId: string; node: NodeId; text: string; ts: string }
  | { kind: "task_complete"; taskId: string; result: string; confidence: number; ts: string }
  | { kind: "task_error"; taskId: string; error: string; ts: string }
  | { kind: "topology"; nodes: Array<{ id: NodeId; pubkey: string; online: boolean }> };

export interface PipelineStep {
  src: NodeId | "user";
  dst: NodeId | "user";
  verb: string;
  msg: string;
  state: "wait" | "run" | "ok" | "err";
  ts?: string;
}

export interface Pipeline {
  id: string;
  text: string;
  steps: PipelineStep[];
}

export interface LogEntry {
  t: string;
  src: string;
  dst: string;
  type: string;
  detail: string;
}
