import client from 'prom-client';
import { MessageSequencer, SequencedEvent } from '../event-bus/message-sequencer';

function getMetric<T>(name: string, factory: () => T): T {
  return (client.register.getSingleMetric(name) as T | undefined) ?? factory();
}

const outOfOrderMessages = getMetric('accounting_reorder_out_of_order_total', () => new client.Counter({
  name: 'accounting_reorder_out_of_order_total',
  help: 'Accounting events received ahead of the expected per-flow sequence number',
  labelNames: ['partition'],
}));

const reorderBufferDepth = getMetric('accounting_reorder_buffer_depth', () => new client.Gauge({
  name: 'accounting_reorder_buffer_depth',
  help: 'Current per-partition accounting event reorder buffer depth',
  labelNames: ['partition'],
}));

const reorderStallDuration = getMetric('accounting_reorder_stall_duration_seconds', () => new client.Histogram({
  name: 'accounting_reorder_stall_duration_seconds',
  help: 'Observed stall duration while waiting for missing per-flow accounting events',
  labelNames: ['partition'],
  buckets: [0.001, 0.01, 0.1, 0.5, 1, 2, 5],
}));

export class AccountingEventProcessor<T = unknown> {
  private readonly stallStartedAt = new Map<string, number>();

  constructor(
    private readonly sequencer = new MessageSequencer(),
    private readonly processReadyEvent: (event: SequencedEvent<T>) => Promise<void> = async () => undefined,
  ) {}

  async handle(event: SequencedEvent<T>): Promise<void> {
    const started = Date.now();
    const result = this.sequencer.accept(event);
    const partition = String(event.partition);

    if (result.stalled) {
      outOfOrderMessages.inc({ partition });
      this.stallStartedAt.set(this.metricKey(event), started);
    }

    reorderBufferDepth.set({ partition }, result.buffered);

    for (const ready of result.ready) {
      const key = this.metricKey(ready);
      const stalledAt = this.stallStartedAt.get(key);
      if (stalledAt !== undefined) {
        reorderStallDuration.observe({ partition: String(ready.partition) }, (Date.now() - stalledAt) / 1000);
        this.stallStartedAt.delete(key);
      }
      await this.processReadyEvent(ready);
    }
  }

  private metricKey(event: SequencedEvent<T>): string {
    return `${event.partition}:${event.flowId}`;
  }
}

export const accountingReorderMetrics = {
  outOfOrderMessages,
  reorderBufferDepth,
  reorderStallDuration,
};
