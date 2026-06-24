export interface EntropyMetricSink {
  gauge(name: string, value: number, labels?: Record<string, string>): void;
  alert?(name: string, value: number, labels?: Record<string, string>): void;
}

export const MEMBERSHIP_VIEW_OVERLAP_METRIC = 'membership_view_overlap_percentage';
export const MEMBERSHIP_VIEW_OVERLAP_ALERT = 'membership_view_overlap_high';
export const MEMBERSHIP_VIEW_OVERLAP_ALERT_THRESHOLD = 20;

export class MembershipViewEntropyTracker {
  private previousView: Set<string> | null = null;

  constructor(private readonly metricSink: EntropyMetricSink, private readonly labels: Record<string, string> = {}) {}

  recordRound(peerIds: readonly string[]): number {
    const currentView = new Set(peerIds);
    const overlap = this.previousView ? this.calculateOverlap(this.previousView, currentView) : 0;

    this.metricSink.gauge(MEMBERSHIP_VIEW_OVERLAP_METRIC, overlap, this.labels);
    if (overlap > MEMBERSHIP_VIEW_OVERLAP_ALERT_THRESHOLD) {
      this.metricSink.alert?.(MEMBERSHIP_VIEW_OVERLAP_ALERT, overlap, this.labels);
    }

    this.previousView = currentView;
    return overlap;
  }

  private calculateOverlap(previousView: Set<string>, currentView: Set<string>): number {
    if (previousView.size === 0 && currentView.size === 0) return 0;
    const [smaller, larger] = previousView.size < currentView.size
      ? [previousView, currentView]
      : [currentView, previousView];
    let shared = 0;
    for (const peerId of smaller) {
      if (larger.has(peerId)) shared += 1;
    }
    return (shared / Math.max(previousView.size, currentView.size)) * 100;
  }
}
