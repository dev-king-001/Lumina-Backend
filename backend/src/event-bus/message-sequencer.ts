export interface SequencedEvent<T = unknown> {
  flowId: string;
  partition: number;
  seqno?: number;
  payload: T;
  publishedAt?: number;
}

export interface ReorderResult<T = unknown> {
  ready: SequencedEvent<T>[];
  buffered: number;
  stalled: boolean;
  dropped: SequencedEvent<T>[];
}

const DEFAULT_REORDER_LIMIT = 500;

export class MessageSequencer {
  private nextSeqno = new Map<string, number>();
  private expectedSeqno = new Map<string, number>();
  private reorderBuffers = new Map<string, Map<number, SequencedEvent>>();

  constructor(private readonly reorderLimit = DEFAULT_REORDER_LIMIT) {}

  assign<T>(event: Omit<SequencedEvent<T>, 'seqno'> & { seqno?: number }): SequencedEvent<T> {
    if (event.seqno !== undefined) return event as SequencedEvent<T>;
    const key = this.key(event.flowId, event.partition);
    const next = this.nextSeqno.get(key) ?? 1;
    this.nextSeqno.set(key, next + 1);
    return { ...event, seqno: next };
  }

  accept<T>(event: SequencedEvent<T>): ReorderResult<T> {
    if (event.seqno === undefined) {
      throw new Error('sequenced event is missing seqno');
    }

    const key = this.key(event.flowId, event.partition);
    const expected = this.expectedSeqno.get(key) ?? 1;

    if (event.seqno < expected) {
      return { ready: [], buffered: this.bufferDepth(key), stalled: false, dropped: [event] };
    }

    if (event.seqno === expected) {
      const ready: SequencedEvent<T>[] = [event];
      let nextExpected = expected + 1;
      const buffer = this.reorderBuffers.get(key);

      while (buffer?.has(nextExpected)) {
        ready.push(buffer.get(nextExpected) as SequencedEvent<T>);
        buffer.delete(nextExpected);
        nextExpected += 1;
      }

      if (buffer?.size === 0) this.reorderBuffers.delete(key);
      this.expectedSeqno.set(key, nextExpected);
      return { ready, buffered: this.bufferDepth(key), stalled: false, dropped: [] };
    }

    const buffer = this.reorderBuffers.get(key) ?? new Map<number, SequencedEvent>();
    buffer.set(event.seqno, event);
    this.reorderBuffers.set(key, buffer);

    const dropped: SequencedEvent<T>[] = [];
    while (buffer.size > this.reorderLimit) {
      const lowest = Math.min(...buffer.keys());
      dropped.push(buffer.get(lowest) as SequencedEvent<T>);
      buffer.delete(lowest);
      this.expectedSeqno.set(key, lowest + 1);
    }

    return { ready: [], buffered: buffer.size, stalled: true, dropped };
  }

  getExpectedSeqno(flowId: string, partition: number): number {
    return this.expectedSeqno.get(this.key(flowId, partition)) ?? 1;
  }

  getReorderDepth(flowId: string, partition: number): number {
    return this.bufferDepth(this.key(flowId, partition));
  }

  private bufferDepth(key: string): number {
    return this.reorderBuffers.get(key)?.size ?? 0;
  }

  private key(flowId: string, partition: number): string {
    return `${partition}:${flowId}`;
  }
}

export const messageSequencer = new MessageSequencer();
