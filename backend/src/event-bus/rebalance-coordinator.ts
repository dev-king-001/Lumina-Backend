import { randomUUID } from 'crypto';
import { ShardedEventBus, PartitionMap } from './sharded-bus';

export interface PartitionOwnerControl {
  activateFence(partition: number, token: string): Promise<void>;
  drain(partition: number): Promise<void>;
  confirmFence(partition: number, token: string): Promise<boolean>;
  assumeOwnership(partition: number, token: string): Promise<void>;
}

export interface RebalancePlan {
  nextOwners: PartitionMap;
  migratingPartitions: number[];
}

export class RebalanceCoordinator {
  constructor(
    private readonly bus: ShardedEventBus,
    private readonly ownerControl: PartitionOwnerControl,
  ) {}

  async rebalance(plan: RebalancePlan): Promise<string> {
    const migrationId = randomUUID();
    const fenceToken = `${migrationId}:${Date.now()}`;

    // Phase 1: stop new writes to moving partitions and fence the old owners.
    this.bus.pauseProduction(plan.migratingPartitions);
    for (const partition of plan.migratingPartitions) {
      await this.ownerControl.activateFence(partition, fenceToken);
    }

    // Phase 2: drain old owner state to WAL, then let the new owner replay before consuming live traffic.
    for (const partition of plan.migratingPartitions) {
      await this.ownerControl.drain(partition);
      await this.bus.flushMigrationLog(partition, migrationId);
      const fenced = await this.ownerControl.confirmFence(partition, fenceToken);
      if (!fenced) throw new Error(`partition ${partition} fence was not confirmed`);
      await this.ownerControl.assumeOwnership(partition, fenceToken);
    }

    this.bus.updatePartitionOwners(plan.nextOwners);
    this.bus.resumeProduction(plan.migratingPartitions);
    return migrationId;
  }
}
