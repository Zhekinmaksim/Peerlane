// Mirror of backend/src/types/messages.ts

export type NodeId = "coord" | "research" | "verify" | "analyst";

export type CapabilityId =
  | "task.entrypoint"
  | "research.market"
  | "verify.claims"
  | "analyst.synthesize";

export type MessageType = "DISPATCH" | "RETURN" | "ACK" | "GOSSIP" | "ERROR";

export interface AgentCard {
  name: string;
  protocolVersion: "1.0";
  skills: Array<{ id: CapabilityId; name: string; description: string; tags: string[] }>;
}

export interface ProtocolPayload {
  binding: string;
  a2a: {
    protocol: "a2a";
    version: "1.0";
    operation: "message/send";
    message: { messageId: string; metadata: Record<string, unknown> };
  };
  mcp?: { protocol: "mcp"; toolName: string; arguments: Record<string, unknown> };
}

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
  protocol?: ProtocolPayload;
  ts: string;
}

export interface ChainTraceEntry {
  mid: string;
  from: NodeId;
  to: NodeId;
  type: MessageType;
  verb: string;
  capability?: CapabilityId;
  protocolBinding?: string;
  mcpTool?: string;
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
  | { kind: "topology"; nodes: Array<{ id: NodeId; pubkey: string; online: boolean; capabilities: CapabilityId[]; agentCard?: AgentCard }> };

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
  mid?: string;
  parentMid?: string;
  protocol?: string;
  mcpTool?: string;
}
