import { FlowTracker } from './flow-tracker';

const FLUSH_INTERVAL_MS = 1;
const BATCH_THRESHOLD = 1000;

interface PendingIncrement {
  flowId: number;
  ingressBytes: number;
  egressBytes: number;
}

export interface BandwidthEvent {
  flowId: number;
  ingressBytes: number;
  egressBytes: number;
  timestamp: number;
}

type Timer = ReturnType<typeof setInterval>;

export class BandwidthCalculator {
  private readonly batch: PendingIncrement[] = [];
  private flushTimer: Timer | null = null;

  constructor(
    private readonly store: { increment(flowId: number, ingressBytes: number, egressBytes: number): void },
    private readonly tracker: FlowTracker,
  ) {
    const t: Timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
    (t as any).unref?.();
    this.flushTimer = t;
  }

  handlePacket(event: BandwidthEvent): void {
    this.tracker.record(event.flowId, event.ingressBytes, event.egressBytes);
    this.batch.push({
      flowId: event.flowId,
      ingressBytes: event.ingressBytes,
      egressBytes: event.egressBytes,
    });
    if (this.batch.length >= BATCH_THRESHOLD) {
      this.flush();
    }
  }

  flush(): void {
    if (this.batch.length === 0) return;
    const batch = this.batch.splice(0);
    for (const inc of batch) {
      this.store.increment(inc.flowId, inc.ingressBytes, inc.egressBytes);
    }
  }

  destroy(): void {
    this.flush();
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.batch.length = 0;
  }
}
