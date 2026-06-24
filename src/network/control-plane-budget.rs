use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum GossipTier {
    MembershipUpdate,
    SyncResponse,
    Probe,
}

pub struct ControlPlaneBudget {
    pub total_bandwidth_bps: usize, // total budget in bytes/sec
    pub tier_allocations: [(GossipTier, f64); 3],
    pub tier_buckets: [f64; 3], // current capacity of each token bucket
    pub last_replenished: Instant,
}

impl ControlPlaneBudget {
    pub fn new(bandwidth_mbps: f64) -> Self {
        // Convert Mbps to Bytes per second: (Mbps * 10^6) / 8
        let total_bandwidth_bps = (bandwidth_mbps * 1_000_000.0 / 8.0) as usize;
        Self {
            total_bandwidth_bps,
            tier_allocations: [
                (GossipTier::MembershipUpdate, 0.30),
                (GossipTier::SyncResponse, 0.20),
                (GossipTier::Probe, 0.50),
            ],
            tier_buckets: [
                total_bandwidth_bps as f64 * 0.30,
                total_bandwidth_bps as f64 * 0.20,
                total_bandwidth_bps as f64 * 0.50,
            ],
            last_replenished: Instant::now(),
        }
    }

    pub fn consume_bandwidth(&mut self, tier: GossipTier, size_bytes: usize, now: Instant) -> bool {
        self.replenish(now);
        
        let idx = self.tier_index(tier);
        if self.tier_buckets[idx] >= size_bytes as f64 {
            self.tier_buckets[idx] -= size_bytes as f64;
            true
        } else {
            false
        }
    }

    fn tier_index(&self, tier: GossipTier) -> usize {
        match tier {
            GossipTier::MembershipUpdate => 0,
            GossipTier::SyncResponse => 1,
            GossipTier::Probe => 2,
        }
    }

    fn replenish(&mut self, now: Instant) {
        let elapsed = now.duration_since(self.last_replenished).as_secs_f64();
        if elapsed <= 0.0 {
            return;
        }
        self.last_replenished = now;

        for i in 0..3 {
            let (_, allocation) = self.tier_allocations[i];
            let rate = self.total_bandwidth_bps as f64 * allocation;
            let capacity = rate; // Capacity capped at 1s rate to prevent bursting beyond 1s allocations
            self.tier_buckets[i] = (self.tier_buckets[i] + rate * elapsed).min(capacity);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bandwidth_allocation_limits() {
        // Budget: 100 Mbps (12,500,000 bytes/sec)
        // Membership: 30% = 3,750,000 bytes/sec
        // SyncResponse: 20% = 2,500,000 bytes/sec
        // Probe: 50% = 6,250,000 bytes/sec
        let mut budget = ControlPlaneBudget::new(100.0);
        let now = Instant::now();

        // Consume exactly within limit
        assert!(budget.consume_bandwidth(GossipTier::MembershipUpdate, 3_000_000, now));
        
        // Exceeding the remaining bucket fails
        assert!(!budget.consume_bandwidth(GossipTier::MembershipUpdate, 1_000_000, now));

        // Other tiers still have their allocations
        assert!(budget.consume_bandwidth(GossipTier::SyncResponse, 2_000_000, now));
        assert!(budget.consume_bandwidth(GossipTier::Probe, 6_000_000, now));
    }

    #[test]
    fn test_replenish() {
        let mut budget = ControlPlaneBudget::new(10.0); // 10 Mbps = 1,250,000 bytes/sec
        let now = Instant::now();

        // Consume all of Membership (30% of 1.25M = 375,000 bytes)
        assert!(budget.consume_bandwidth(GossipTier::MembershipUpdate, 375_000, now));
        assert!(!budget.consume_bandwidth(GossipTier::MembershipUpdate, 100, now));

        // Advance time by 0.5 seconds (replenishes 187,500 bytes)
        let later = now + Duration::from_millis(500);
        assert!(budget.consume_bandwidth(GossipTier::MembershipUpdate, 100_000, later));
    }
}
