export interface RouteEntry {
  backendId: string;
  weight: number; // calculated weight (0 - 100)
  ewmaLatencyMs: number; // EWMA of recent latency
  activeConnections: number;
}

export class RouteTable {
  private routes: RouteEntry[] = [];
  private readonly alpha = 0.2; // EWMA decay factor
  private rrIndex = 0; // round robin index

  constructor(backends: { backendId: string; weight: number }[]) {
    this.routes = backends.map((b) => ({
      backendId: b.backendId,
      weight: b.weight,
      ewmaLatencyMs: 50.0, // initial default latency
      activeConnections: 0,
    }));
  }

  updateWeight(backendId: string, weight: number): void {
    const route = this.routes.find((r) => r.backendId === backendId);
    if (route) {
      route.weight = weight;
    }
  }

  // Update EWMA latency per request completion
  recordRequestLatency(backendId: string, latencyMs: number): void {
    const route = this.routes.find((r) => r.backendId === backendId);
    if (route) {
      route.ewmaLatencyMs = this.alpha * latencyMs + (1 - this.alpha) * route.ewmaLatencyMs;
    }
  }

  // Weighted Round Robin selection based on effective weight
  // Effective Weight = Weight / (EWMA Latency + epsilon)
  selectRoute(): string | null {
    const activeRoutes = this.routes.filter((r) => r.weight > 0);
    if (activeRoutes.length === 0) {
      return null;
    }

    // Calculate effective weights
    const effectiveWeights = activeRoutes.map((route) => {
      const latencyFactor = Math.max(1, route.ewmaLatencyMs);
      const effectiveWeight = route.weight / latencyFactor;
      return {
        route,
        effectiveWeight,
      };
    });

    let totalEffectiveWeight = effectiveWeights.reduce((sum, item) => sum + item.effectiveWeight, 0);
    if (totalEffectiveWeight <= 0) {
      const selected = activeRoutes[this.rrIndex % activeRoutes.length];
      this.rrIndex++;
      return selected.backendId;
    }

    const threshold = Math.random() * totalEffectiveWeight;
    let cumulative = 0;
    for (const item of effectiveWeights) {
      cumulative += item.effectiveWeight;
      if (cumulative >= threshold) {
        return item.route.backendId;
      }
    }

    return activeRoutes[activeRoutes.length - 1].backendId;
  }

  getRoutes(): RouteEntry[] {
    return this.routes;
  }
}
