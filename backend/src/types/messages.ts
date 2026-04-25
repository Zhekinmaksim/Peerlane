/**
 * Message envelope used across all Peerlane agents over AXL.
 * Kept intentionally small — AXL is application-agnostic, so we define
 * our own schema on top. Serialized as JSON.
 */

export type NodeId = "coord" | "research" | "verify" | "analyst";

export type CapabilityId =
  | "task.entrypoint"
  | "research.market"
  | "verify.claims"
  | "analyst.synthesize";

export type MessageType =
  | "DISPATCH"   // coord → worker: "do subtask X"
  | "RETURN"     // worker → coord: "here is my result"
  | "ACK"        // acknowledgment
  | "GOSSIP"     // worker → peers: intermediate result broadcast
  | "ERROR";     // worker failed

export interface AgentSkill {
  id: CapabilityId;
  name: string;
  description: string;
  tags: string[];
}

export interface AgentCard {
  name: string;
  description: string;
  protocolVersion: "1.0";
  supportedInterfaces: Array<{
    url: string;
    protocolBinding: string;
    protocolVersion: "1.0";
  }>;
  capabilities: {
    streaming: boolean;
    stateTransitionHistory: boolean;
    extendedAgentCard: boolean;
  };
  skills: AgentSkill[];
  metadata: {
    nodeId: NodeId;
    axlPubkey: string;
    axlApiPort: number;
  };
}

export interface A2AMessageSend {
  protocol: "a2a";
  version: "1.0";
  operation: "message/send";
  message: {
    role: "ROLE_USER" | "ROLE_AGENT";
    parts: Array<{ text: string; metadata?: Record<string, unknown> }>;
    messageId: string;
    taskId: string;
    contextId: string;
    metadata: Record<string, unknown>;
  };
}

export interface McpToolUse {
  protocol: "mcp";
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface ProtocolPayload {
  binding: string;
  a2a: A2AMessageSend;
  mcp?: McpToolUse;
}

export interface PeerlaneMessage {
  /** Version of the envelope format. */
  v: 1;
  /** Unique message id. */
  mid: string;
  /** Task this message belongs to. */
  taskId: string;
  /** For sub-dispatches, the parent message. */
  parentMid?: string;
  /** Logical sender (role). The AXL public key lives separately in the transport layer. */
  from: NodeId;
  /** Logical destination. */
  to: NodeId;
  /** Message kind. */
  type: MessageType;
  /** What the worker should do / what was done. */
  verb: string;
  /** Task-specific payload. */
  payload: unknown;
  /** A2A/MCP-compatible structured payload carried over AXL as a custom binding. */
  protocol?: ProtocolPayload;
  /** ISO timestamp. */
  ts: string;
}

export interface ChainHop {
  node: Exclude<NodeId, "coord">;
  capability: CapabilityId;
  verb: string;
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

/** Sent from the coordinator to a worker agent. */
export interface DispatchPayload {
  question: string;
  capability?: CapabilityId;
  context?: string;
  // Previous findings from other agents, so workers can build on each other.
  priorFindings?: Partial<Record<NodeId, string>>;
  // Remaining direct peer-to-peer hops after the current worker finishes.
  route?: ChainHop[];
  // Contributions and trace accumulated by workers during a chained run.
  contributions?: Partial<Record<NodeId, string>>;
  trace?: ChainTraceEntry[];
}

/** Worker → coord result. */
export interface ReturnPayload {
  text: string;
  confidence?: number;
  error?: string;
  contributions?: Partial<Record<NodeId, string>>;
  trace?: ChainTraceEntry[];
}

/** WebSocket event published to the frontend. */
export type WsEvent =
  | { kind: "task_started"; taskId: string; question: string; ts: string }
  | { kind: "message"; message: PeerlaneMessage }
  | { kind: "node_busy"; node: NodeId; busy: boolean; ts: string }
  | { kind: "step_update"; taskId: string; stepIndex: number; state: "wait" | "run" | "ok" | "err"; msg?: string; ts: string }
  | { kind: "contribution"; taskId: string; node: NodeId; text: string; ts: string }
  | { kind: "task_complete"; taskId: string; result: string; confidence: number; ts: string }
  | { kind: "task_error"; taskId: string; error: string; ts: string }
  | { kind: "topology"; nodes: Array<{ id: NodeId; pubkey: string; online: boolean; capabilities: CapabilityId[]; agentCard?: AgentCard }> };
