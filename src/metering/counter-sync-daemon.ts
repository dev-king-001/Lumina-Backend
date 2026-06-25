declare function require(module: string): any;

import { FlowTracker } from './flow-tracker';

const SYNC_INTERVAL_MS = 5000;
const WATCHDOG_POLL_INTERVAL_MS = 1000;
const PRESSURE_THRESHOLD = 0.6;
const RECOVERY_THRESHOLD = 0.3;
const CGROUP_PRESSURE_PATH = '/sys/fs/cgroup/memory.pressure';

interface CounterSnapshot {
  flowId: number;
  ingressBytes: number;
  egressBytes: number;
}

export class CounterSyncDaemon {
  private syncTimer: any = null;
  private watchdogTimer: any = null;

  constructor(
    private readonly store: {
      snapshotShard(shardId: number): number[][];
      resetShard(shardId: number): number[][];
      flowTarget(): number;
    },
    private readonly flowTracker: FlowTracker,
    private readonly persist: (entries: CounterSnapshot[]) => Promise<void>,
    private readonly onReduce?: (pct: number) => void,
    private readonly onRestore?: (pct: number) => void,
  ) {}

  start(): void {
    const st: any = setInterval(() => this.syncCycle(), SYNC_INTERVAL_MS);
    st.unref?.();
    this.syncTimer = st;

    const wt: any = setInterval(() => this.watchdogCycle(), WATCHDOG_POLL_INTERVAL_MS);
    wt.unref?.();
    this.watchdogTimer = wt;
  }

  stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private async syncCycle(): Promise<void> {
    try {
      const entries = this.collectNonZero();
      if (entries.length > 0) {
        await this.persist(entries);
      }
    } catch (err) {
      console.error('[counter-sync-daemon] sync cycle failed:', err);
    }
  }

  private collectNonZero(): CounterSnapshot[] {
    const result: CounterSnapshot[] = [];
    for (let shard = 0; shard < 64; shard++) {
      const rows = this.store.snapshotShard(shard);
      for (const [flowId, ingressBytes, egressBytes] of rows) {
        result.push({ flowId: Number(flowId), ingressBytes: Number(ingressBytes), egressBytes: Number(egressBytes) });
      }
    }
    return result;
  }

  private async watchdogCycle(): Promise<void> {
    const pressure = await this.readMemoryPressure();
    if (pressure === null) return;

    if (pressure >= PRESSURE_THRESHOLD) {
      if (this.onReduce) {
        this.onReduce(10);
      }
    } else if (pressure <= RECOVERY_THRESHOLD) {
      const target = this.store.flowTarget();
      if (target < 500_000 && this.onRestore) {
        this.onRestore(5);
      }
    }
  }

  async readMemoryPressure(): Promise<number | null> {
    try {
      const fs: any = require('fs');
      const content: string = fs.readFileSync(CGROUP_PRESSURE_PATH, 'utf-8');
      for (const line of content.split('\n')) {
        if (line.startsWith('some ')) {
          const match = line.match(/avg10=([0-9.]+)/);
          if (match) {
            return parseFloat(match[1]);
          }
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  async runSingleSync(): Promise<CounterSnapshot[]> {
    const entries = this.collectNonZero();
    if (entries.length > 0) {
      await this.persist(entries);
    }
    return entries;
  }
}
