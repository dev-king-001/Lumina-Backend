import { FlowRecord, FlowTracker, globalFlowTracker } from './flow-tracker';

export class NicAggregator {
  private mergedTable: Map<string, FlowRecord> = new Map();

  /**
   * Reconciles cross-NIC flows from all shards in the flow tracker.
   */
  public reconcile(tracker: FlowTracker) {
    const shards = tracker.getShards();
    const newMerged: Map<string, FlowRecord> = new Map();

    for (const shard of shards) {
      for (const [hash, record] of shard.entries()) {
        let existing = newMerged.get(hash);
        if (!existing) {
          newMerged.set(hash, {
            canonicalHash: hash,
            tuple: record.tuple,
            ingressBytes: record.ingressBytes,
            egressBytes: record.egressBytes
          });
        } else {
          existing.ingressBytes += record.ingressBytes;
          existing.egressBytes += record.egressBytes;
        }
      }
    }

    this.mergedTable = newMerged;
    this.checkAsymmetricRoutingCompensation();
  }

  /**
   * Evaluates asymmetric routing and flags potential double counting.
   */
  private checkAsymmetricRoutingCompensation() {
    for (const [hash, record] of this.mergedTable.entries()) {
      const ingress = record.ingressBytes;
      const egress = record.egressBytes;
      
      if (ingress === 0n || egress === 0n) continue;
      
      const diff = ingress > egress ? ingress - egress : egress - ingress;
      const max = ingress > egress ? ingress : egress;
      
      // If ingress and egress bytes for a canonical flow differ by >20%
      if (diff * 100n > max * 20n) {
        // We retain both counters independently (they are inherently separate in FlowRecord).
        // Report an alert for telemetry monitoring.
        console.warn(`[ALERT] Asymmetric routing detected for flow ${hash}. Ingress: ${ingress}, Egress: ${egress}`);
      }
    }
  }
  
  /**
   * Sums ingress and egress only at read time to avoid intermediate skew.
   */
  public getTotalBytes(hash: string): bigint {
    const record = this.mergedTable.get(hash);
    if (!record) return 0n;
    return record.ingressBytes + record.egressBytes;
  }
}

export const globalNicAggregator = new NicAggregator();

// Background merge thread reconciles cross-NIC flows every 10s
setInterval(() => {
  globalNicAggregator.reconcile(globalFlowTracker);
}, 10000);
