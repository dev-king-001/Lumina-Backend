import { CanonicalFlowTuple, hashCanonicalFlow } from './flow-normalizer';

const METERING_NIC_COUNT = 8;
const HASH_TABLE_SIZE = 500_000;

export interface FlowRecord {
  canonicalHash: string;
  tuple: CanonicalFlowTuple;
  ingressBytes: bigint;
  egressBytes: bigint;
}

/**
 * Tracks flows partitioned by NIC ID with a shared merge step.
 * Each NIC writes to its local shard.
 */
export class FlowTracker {
  private shards: Map<string, FlowRecord>[];

  constructor() {
    this.shards = Array.from({ length: METERING_NIC_COUNT }, () => new Map<string, FlowRecord>());
  }

  /**
   * Records traffic bytes for a specific NIC.
   */
  public recordTraffic(nicId: number, tuple: CanonicalFlowTuple, bytes: bigint) {
    if (nicId < 0 || nicId >= METERING_NIC_COUNT) return;
    
    const hash = hashCanonicalFlow(tuple);
    const shard = this.shards[nicId];
    
    let record = shard.get(hash);
    if (!record) {
      // Prevent unbounded growth by capping per-shard table size
      if (shard.size >= Math.floor(HASH_TABLE_SIZE / METERING_NIC_COUNT)) {
        // Eviction policy: simple drop-new-entries for now
        return;
      }
      record = {
        canonicalHash: hash,
        tuple: tuple,
        ingressBytes: 0n,
        egressBytes: 0n
      };
      shard.set(hash, record);
    }
    
    if (tuple.isIngress) {
      record.ingressBytes += bytes;
    } else {
      record.egressBytes += bytes;
    }
  }

  public getShards(): Map<string, FlowRecord>[] {
    return this.shards;
  }
}

export const globalFlowTracker = new FlowTracker();
