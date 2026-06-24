import { deriveNodeId } from '../utils/node-id-deriver';
import { randomSubset, SeedInput } from './random-subset';

export const GOSSIP_INTERVAL_MS = 100;
export const GOSSIP_FANOUT = Number(process.env.GOSSIP_FANOUT ?? 3);
export const GOSSIP_STARTUP_OFFSET_BUCKETS = 5;
export const GOSSIP_STARTUP_OFFSET_MS = 20;

export interface GossipPeer {
  id: string;
  address?: string;
}

export interface GossipRoundContext {
  roundNumber: SeedInput;
  nodeId: SeedInput;
  clusterEpoch: SeedInput;
  fanout?: number;
}

export function gossipStartupOffsetMs(nodeId: SeedInput): number {
  const numericNodeId = typeof nodeId === 'bigint' ? nodeId : deriveNodeId(String(nodeId));
  return Number(numericNodeId % BigInt(GOSSIP_STARTUP_OFFSET_BUCKETS)) * GOSSIP_STARTUP_OFFSET_MS;
}

export function selectGossipPeers<T extends GossipPeer>(peers: readonly T[], context: GossipRoundContext): T[] {
  return randomSubset(peers, context.fanout ?? GOSSIP_FANOUT, context);
}

export function scheduleGossipStart(nodeId: SeedInput, start: () => void): NodeJS.Timeout {
  return setTimeout(start, gossipStartupOffsetMs(nodeId));
}
