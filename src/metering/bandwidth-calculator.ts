import { FlowTuple, normalizeFlow } from './flow-normalizer';
import { globalFlowTracker } from './flow-tracker';

export class BandwidthCalculator {
  /**
   * Normalizes the packet flow and dispatches the counter update to the appropriate NIC shard.
   */
  public static dispatchCounterUpdate(nicId: number, flow: FlowTuple, bytes: bigint) {
    const canonical = normalizeFlow(flow);
    globalFlowTracker.recordTraffic(nicId, canonical, bytes);
  }
}
