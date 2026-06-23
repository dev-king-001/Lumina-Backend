import { promises as fs } from 'fs';
import path from 'path';
import { MessageSequencer, SequencedEvent } from './message-sequencer';

export type PartitionMap = Map<number, string>;

export interface MigrationLogRecord<T = unknown> extends SequencedEvent<T> {
  migrationId: string;
  ownerNodeId: string;
  flushedAt: number;
}

export class FileMigrationLog {
  constructor(private readonly baseDir = process.env.EVENT_BUS_MIGRATION_LOG_DIR ?? '/tmp/lumina-event-bus-migration') {}

  async append<T>(partition: number, records: MigrationLogRecord<T>[]): Promise<void> {
    if (records.length === 0) return;
    await fs.mkdir(this.baseDir, { recursive: true });
    const file = this.fileFor(partition);
    const payload = records.map((record) => JSON.stringify(record)).join('\n') + '\n';
    await fs.appendFile(file, payload, 'utf8');
  }

  async replay<T>(partition: number): Promise<MigrationLogRecord<T>[]> {
    try {
      const content = await fs.readFile(this.fileFor(partition), 'utf8');
      return content.trim().length === 0 ? [] : content.trim().split('\n').map((line) => JSON.parse(line));
    } catch (error: any) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async clear(partition: number): Promise<void> {
    await fs.rm(this.fileFor(partition), { force: true });
  }

  private fileFor(partition: number): string {
    return path.join(this.baseDir, `partition-${partition}.wal`);
  }
}

export class ShardedEventBus {
  private readonly partitionCount: number;
  private readonly buffers = new Map<number, SequencedEvent[]>();
  private pausedPartitions = new Set<number>();

  constructor(
    private partitionOwners: PartitionMap,
    private readonly localNodeId: string,
    private readonly sequencer = new MessageSequencer(),
    private readonly migrationLog = new FileMigrationLog(),
    partitionCount = Number(process.env.EVENT_BUS_PARTITIONS ?? 64),
  ) {
    this.partitionCount = partitionCount;
  }

  async publish<T>(flowId: string, payload: T): Promise<SequencedEvent<T>> {
    const partition = this.partitionFor(flowId);
    if (this.pausedPartitions.has(partition)) {
      throw new Error(`partition ${partition} is paused for rebalance`);
    }

    const event = this.sequencer.assign({ flowId, partition, payload, publishedAt: Date.now() });
    const buffer = this.buffers.get(partition) ?? [];
    buffer.push(event);
    this.buffers.set(partition, buffer);
    return event;
  }

  pauseProduction(partitions: number[]): void {
    partitions.forEach((partition) => this.pausedPartitions.add(partition));
  }

  resumeProduction(partitions: number[]): void {
    partitions.forEach((partition) => this.pausedPartitions.delete(partition));
  }

  async flushMigrationLog(partition: number, migrationId: string): Promise<MigrationLogRecord[]> {
    const buffer = this.buffers.get(partition) ?? [];
    const records = buffer.map((event) => ({ ...event, migrationId, ownerNodeId: this.localNodeId, flushedAt: Date.now() }));
    await this.migrationLog.append(partition, records);
    this.buffers.set(partition, []);
    return records;
  }

  async replayMigrationLog(partition: number): Promise<MigrationLogRecord[]> {
    return this.migrationLog.replay(partition);
  }

  updatePartitionOwners(nextOwners: PartitionMap): void {
    this.partitionOwners = nextOwners;
  }

  partitionFor(flowId: string): number {
    let hash = 0;
    for (let i = 0; i < flowId.length; i += 1) hash = (hash * 31 + flowId.charCodeAt(i)) >>> 0;
    return hash % this.partitionCount;
  }
}
