import type {
  A2AMessageSend,
  AgentCard,
  AgentSkill,
  CapabilityId,
  McpToolUse,
  NodeId,
  PeerlaneMessage,
} from "../types/messages.js";

export const AXL_A2A_BINDING = "https://peerlane.local/bindings/axl-a2a/v1";

const SKILLS: Record<NodeId, AgentSkill[]> = {
  coord: [
    {
      id: "task.entrypoint",
      name: "Task entrypoint",
      description: "Accept user tasks, select peers by capability, and publish UI updates.",
      tags: ["gateway", "routing", "websocket"],
    },
  ],
  research: [
    {
      id: "research.market",
      name: "Research market and sources",
      description: "Gather source-backed research notes for the requested task.",
      tags: ["research", "sources", "crypto"],
    },
  ],
  verify: [
    {
      id: "verify.claims",
      name: "Verify claims",
      description: "Cross-check previous findings and score confidence.",
      tags: ["verification", "risk", "confidence"],
    },
  ],
  analyst: [
    {
      id: "analyst.synthesize",
      name: "Synthesize final report",
      description: "Turn verified findings into a concise final answer.",
      tags: ["analysis", "synthesis", "reporting"],
    },
  ],
};

export function skillsFor(role: NodeId): AgentSkill[] {
  return SKILLS[role];
}

export function capabilitiesFor(role: NodeId): CapabilityId[] {
  return skillsFor(role).map((skill) => skill.id);
}

export function makeAgentCard(role: NodeId, pubkey: string, apiPort: number): AgentCard {
  return {
    name: `Peerlane ${role}`,
    description: `Peerlane ${role} agent reachable through AXL custom A2A binding.`,
    protocolVersion: "1.0",
    supportedInterfaces: [
      {
        url: `axl://pubkey/${pubkey}`,
        protocolBinding: AXL_A2A_BINDING,
        protocolVersion: "1.0",
      },
    ],
    capabilities: {
      streaming: false,
      stateTransitionHistory: true,
      extendedAgentCard: true,
    },
    skills: skillsFor(role),
    metadata: {
      nodeId: role,
      axlPubkey: pubkey,
      axlApiPort: apiPort,
    },
  };
}

export function attachProtocol(
  message: PeerlaneMessage,
  capability: CapabilityId,
  text: string,
): PeerlaneMessage {
  return {
    ...message,
    protocol: {
      binding: AXL_A2A_BINDING,
      a2a: makeA2AMessage(message, capability, text),
      mcp: makeMcpToolUse(capability, text),
    },
  };
}

function makeA2AMessage(
  message: PeerlaneMessage,
  capability: CapabilityId,
  text: string,
): A2AMessageSend {
  return {
    protocol: "a2a",
    version: "1.0",
    operation: "message/send",
    message: {
      role: message.from === "coord" ? "ROLE_USER" : "ROLE_AGENT",
      parts: [
        {
          text,
          metadata: {
            mediaType: "text/plain",
            peerlaneCapability: capability,
          },
        },
      ],
      messageId: message.mid,
      taskId: message.taskId,
      contextId: message.taskId,
      metadata: {
        from: message.from,
        to: message.to,
        type: message.type,
        verb: message.verb,
        capability,
        transport: "gensyn-axl",
      },
    },
  };
}

function makeMcpToolUse(capability: CapabilityId, text: string): McpToolUse {
  return {
    protocol: "mcp",
    toolName: capabilityToTool(capability),
    arguments: {
      input: text,
      capability,
    },
  };
}

function capabilityToTool(capability: CapabilityId): string {
  switch (capability) {
    case "task.entrypoint":
      return "peerlane.route_task";
    case "research.market":
      return "peerlane.gather_sources";
    case "verify.claims":
      return "peerlane.cross_reference";
    case "analyst.synthesize":
      return "peerlane.synthesize_report";
  }
}
