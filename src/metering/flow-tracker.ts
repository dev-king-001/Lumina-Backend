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
const MAX_FLOWS = 500_000;
const FLOW_TTL_MS = 300_000;
const CLEANUP_INTERVAL_MS = 15_000;
const DEFAULT_REDUCTION_PCT = 10;

export interface FlowEntry {
  flowId: number;
  lastSeen: number;
  ingressBytes: number;
  egressBytes: number;
}

interface FlowTable {
  [flowId: number]: FlowEntry;
}

export class FlowTracker {
  private flows: FlowTable = Object.create(null);
  private maxFlows: number = MAX_FLOWS;
  private cleanupTimer: any = null;

  constructor(maxFlows?: number) {
    if (maxFlows !== undefined && maxFlows > 0) {
      this.maxFlows = maxFlows;
    }
    this.startCleanup();
  }

  touch(flowId: number): FlowEntry {
    let entry = this.flows[flowId];
    if (!entry) {
      if (this.size() >= this.maxFlows) {
        this.evictStale();
      }
      if (this.size() >= this.maxFlows) {
        this.evictLRU();
      }
      if (this.size() >= this.maxFlows) {
        return this.flows[flowId];
      }
      entry = { flowId, lastSeen: Date.now(), ingressBytes: 0, egressBytes: 0 };
      this.flows[flowId] = entry;
    }
    entry.lastSeen = Date.now();
    return entry;
  }

  record(flowId: number, ingressBytes: number, egressBytes: number): void {
    const entry = this.touch(flowId);
    entry.ingressBytes += ingressBytes;
    entry.egressBytes += egressBytes;
  }

  get(flowId: number): FlowEntry | undefined {
    return this.flows[flowId];
  }

  remove(flowId: number): void {
    delete this.flows[flowId];
  }

  size(): number {
    return Object.keys(this.flows).length;
  }

  getAll(): FlowEntry[] {
    return Object.values(this.flows);
  }

  getActiveFlows(since: number): FlowEntry[] {
    return Object.values(this.flows).filter((f) => f.lastSeen >= since);
  }

  setMaxFlows(n: number): void {
    this.maxFlows = Math.max(1, Math.min(n, MAX_FLOWS));
    while (this.size() > this.maxFlows) {
      this.evictLRU();
    }
  }

  reduceBy(pct: number = DEFAULT_REDUCTION_PCT): void {
    const reduction = Math.max(1, Math.floor(this.maxFlows * pct / 100));
    this.setMaxFlows(this.maxFlows - reduction);
  }

  restoreBy(pct: number = 5): void {
    const increase = Math.max(1, Math.floor(this.maxFlows * pct / 100));
    this.setMaxFlows(Math.min(this.maxFlows + increase, MAX_FLOWS));
  }

  private evictStale(): void {
    const cutoff = Date.now() - FLOW_TTL_MS;
    for (const id of Object.keys(this.flows)) {
      if (this.flows[Number(id)].lastSeen < cutoff) {
        delete this.flows[Number(id)];
      }
    }
  }

  private evictLRU(): void {
    const entries = Object.values(this.flows);
    entries.sort((a, b) => a.lastSeen - b.lastSeen);
    const toRemove = Math.max(1, Math.floor(entries.length * 0.1));
    for (let i = 0; i < toRemove && i < entries.length; i++) {
      delete this.flows[entries[i].flowId];
    }
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.evictStale();
    }, CLEANUP_INTERVAL_MS);
    this.cleanupTimer?.unref?.();
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.flows = Object.create(null);
  }
}
