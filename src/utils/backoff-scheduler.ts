export class BackoffScheduler {
  private baseDelayMs: number;
  private maxDelayMs: number;

  constructor(baseDelayMs = 1000, maxDelayMs = 30000) {
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
  }

  getDelay(attempt: number): number {
    // delay = min(base * 2^attempt, max)
    const delay = this.baseDelayMs * Math.pow(2, attempt);
    return Math.min(delay, this.maxDelayMs);
  }
}
