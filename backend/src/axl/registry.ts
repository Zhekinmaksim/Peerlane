/**
 * Peer registry.
 *
 * AXL public keys must be exchanged out-of-band — the docs are explicit:
 * "There is no way to look up another node's key from the network.
 *  Keys MUST be exchanged directly between people."
 *
 * So during startup, each agent:
 *   1. Starts its own AXL node (with its own private.pem),
 *   2. Fetches its own public key from /topology,
 *   3. Writes {role → pubkey} to a shared registry file,
 *   4. Waits until all expected roles have registered.
 *
 * This is a file-based rendezvous. In production you'd use a peer-discovery
 * mechanism (DHT, a bootstrap peer, hard-coded keys, etc.). For the demo,
 * a shared JSON file on the local filesystem is simplest and makes the
 * mesh topology inspectable.
 */

import { readFile, writeFile, mkdir, rename, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentCard, CapabilityId, NodeId } from "../types/messages.js";

export interface PeerEntry {
  pubkey: string;
  apiPort: number;
  registeredAt: string;
  capabilities: CapabilityId[];
  agentCard?: AgentCard;
}

export interface PeerRegistry {
  // Updated atomically by each agent on startup.
  peers: Partial<Record<NodeId, PeerEntry>>;
}

const EXPECTED_ROLES: NodeId[] = ["coord", "research", "verify", "analyst"];

export async function readRegistry(path: string): Promise<PeerRegistry> {
  const reg: PeerRegistry = { peers: {} };

  try {
    const files = await readdir(roleDir(path));
    await Promise.all(files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => {
        const raw = await readFile(join(roleDir(path), file), "utf-8");
        const role = file.replace(/\.json$/, "") as NodeId;
        reg.peers[role] = JSON.parse(raw) as PeerRegistry["peers"][NodeId];
      }));
    return reg;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  try {
    const raw = await readFile(path, "utf-8");
    if (!raw.trim()) return reg;
    return JSON.parse(raw) as PeerRegistry;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return reg;
    }
    throw err;
  }
}

function roleDir(path: string): string {
  return path + ".d";
}

async function writeRegistrySnapshot(path: string, reg: PeerRegistry): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(reg, null, 2), "utf-8");
  await rename(tmp, path);
}

/** Register this agent's pubkey under its logical role. */
export async function registerSelf(
  path: string,
  role: NodeId,
  pubkey: string,
  apiPort: number,
  options: { capabilities?: CapabilityId[]; agentCard?: AgentCard } = {},
): Promise<void> {
  await mkdir(roleDir(path), { recursive: true });
  const entry: PeerEntry = {
    pubkey,
    apiPort,
    registeredAt: new Date().toISOString(),
    capabilities: options.capabilities ?? [],
    agentCard: options.agentCard,
  };
  const rolePath = join(roleDir(path), `${role}.json`);
  const tmp = `${rolePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(entry, null, 2), "utf-8");
  await rename(tmp, rolePath);

  // Keep the aggregate file inspectable for demos (`cat mesh-registry.json`).
  const reg = await readRegistry(path);
  reg.peers[role] = entry;
  await writeRegistrySnapshot(path, reg);
}

/**
 * Block until every expected role has registered, or timeout.
 * Each agent does this after publishing its own key.
 */
export async function waitForAllPeers(
  path: string,
  timeoutMs = 60_000,
  pollIntervalMs = 500,
): Promise<PeerRegistry> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const reg = await readRegistry(path);
    const missing = EXPECTED_ROLES.filter((r) => !reg.peers[r]);
    if (missing.length === 0) {
      await writeRegistrySnapshot(path, reg);
      return reg;
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  const reg = await readRegistry(path);
  const missing = EXPECTED_ROLES.filter((r) => !reg.peers[r]);
  throw new Error(`Timed out waiting for peers. Missing: ${missing.join(", ")}`);
}

export function lookupPubkey(reg: PeerRegistry, role: NodeId): string {
  const entry = reg.peers[role];
  if (!entry) throw new Error(`No registered pubkey for role "${role}"`);
  return entry.pubkey;
}

export function findPeerByCapability(
  reg: PeerRegistry,
  capability: CapabilityId,
): Exclude<NodeId, "coord"> {
  for (const [role, entry] of Object.entries(reg.peers) as Array<[NodeId, PeerEntry | undefined]>) {
    if (role === "coord") continue;
    if (!entry) continue;
    if (entry.capabilities.includes(capability)) return role;
    if (entry.agentCard?.skills.some((skill) => skill.id === capability)) return role;
  }
  throw new Error(`No registered peer advertises capability "${capability}"`);
}
