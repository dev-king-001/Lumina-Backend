import { BackoffScheduler } from '../utils/backoff-scheduler';

export class JoinHandler {
  private joinTimes: number[] = [];
  private scheduler: BackoffScheduler;

  constructor(scheduler: BackoffScheduler) {
    this.scheduler = scheduler;
  }

  recordJoin(): void {
    this.joinTimes.push(Date.now());
    this.cleanupOldJoins();
  }

  private cleanupOldJoins(): void {
    const now = Date.now();
    this.joinTimes = this.joinTimes.filter(t => now - t <= 10000); // 10s sliding window
  }

  getThrottleFactor(): number {
    this.cleanupOldJoins();
    const count = this.joinTimes.length;
    if (count <= 5) {
      return 1.0;
    }
    // Throttle by 2x per additional joining node beyond 5
    return Math.pow(2, count - 5);
  }

  getSyncDelay(attempt: number): number {
    const baseDelay = this.scheduler.getDelay(attempt);
    const throttle = this.getThrottleFactor();
    return baseDelay * throttle;
  }
}
