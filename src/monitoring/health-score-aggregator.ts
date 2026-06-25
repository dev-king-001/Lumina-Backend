export interface NodeMetrics {
  backendId: string;
  cpuUsagePercent: number; // 0 - 100
  memoryUsagePercent: number; // 0 - 100
  errorRatePercent: number; // 0 - 100
  latencyP95Ms: number; // P95 latency in ms
}

export class HealthScoreAggregator {
  // Weights for different metrics (must sum to 1.0)
  private readonly cpuWeight = 0.2;
  private readonly memoryWeight = 0.3;
  private readonly errorRateWeight = 0.3;
  private readonly latencyWeight = 0.2;

  // Thresholds
  private readonly latencyLimitMs = 500;

  calculateHealthScore(metrics: NodeMetrics): number {
    // 1. CPU Score (higher usage drops score)
    const cpuScore = Math.max(0, 100 - metrics.cpuUsagePercent);

    // 2. Memory Score (higher usage drops score)
    const memoryScore = Math.max(0, 100 - metrics.memoryUsagePercent);

    // 3. Error Rate Score (higher error rate drops score)
    const errorRateScore = Math.max(0, 100 - metrics.errorRatePercent);

    // 4. Latency Score (linear scale up to latencyLimitMs)
    const latencyScore = metrics.latencyP95Ms >= this.latencyLimitMs
      ? 0
      : Math.max(0, 100 * (1 - metrics.latencyP95Ms / this.latencyLimitMs));

    // Aggregate with weights
    const compositeScore = 
      (cpuScore * this.cpuWeight) +
      (memoryScore * this.memoryWeight) +
      (errorRateScore * this.errorRateWeight) +
      (latencyScore * this.latencyWeight);

    return Math.min(100, Math.max(0, Math.round(compositeScore)));
  }
}
