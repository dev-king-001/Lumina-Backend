use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncType {
    Full,
    Incremental,
}

pub struct SyncRequest {
    pub node_id: String,
    pub attempt: u32,
    pub next_run: Instant,
}

pub struct StateSyncManager {
    pub active_syncs: usize,
    pub max_simultaneous_syncs: usize,
    pub sync_queue: VecDeque<SyncRequest>,
    pub last_sync_times: HashMap<String, Instant>,
    pub base_backoff: Duration,
    pub max_backoff: Duration,
}

impl StateSyncManager {
    pub fn new() -> Self {
        Self {
            active_syncs: 0,
            max_simultaneous_syncs: 5,
            sync_queue: VecDeque::new(),
            last_sync_times: HashMap::new(),
            base_backoff: Duration::from_secs(1),
            max_backoff: Duration::from_secs(30),
        }
    }

    pub fn request_sync(&mut self, node_id: String, now: Instant) -> Option<SyncType> {
        let is_incremental = if let Some(&last_time) = self.last_sync_times.get(&node_id) {
            now.duration_since(last_time) <= Duration::from_secs(60)
        } else {
            false
        };

        if is_incremental {
            self.last_sync_times.insert(node_id, now);
            return Some(SyncType::Incremental);
        }

        if self.active_syncs < self.max_simultaneous_syncs {
            self.active_syncs += 1;
            self.last_sync_times.insert(node_id, now);
            Some(SyncType::Full)
        } else {
            let delay = self.calculate_backoff(0);
            self.sync_queue.push_back(SyncRequest {
                node_id,
                attempt: 0,
                next_run: now + delay,
            });
            None
        }
    }

    pub fn complete_sync(&mut self) {
        if self.active_syncs > 0 {
            self.active_syncs -= 1;
        }
    }

    pub fn tick(&mut self, now: Instant) -> Vec<(String, SyncType)> {
        let mut ready = Vec::new();
        let mut postponed = VecDeque::new();

        while let Some(req) = self.sync_queue.pop_front() {
            if now >= req.next_run {
                if self.active_syncs < self.max_simultaneous_syncs {
                    self.active_syncs += 1;
                    self.last_sync_times.insert(req.node_id.clone(), now);
                    ready.push((req.node_id, SyncType::Full));
                } else {
                    let next_attempt = req.attempt + 1;
                    let delay = self.calculate_backoff(next_attempt);
                    postponed.push_back(SyncRequest {
                        node_id: req.node_id,
                        attempt: next_attempt,
                        next_run: now + delay,
                    });
                }
            } else {
                postponed.push_back(req);
            }
        }

        self.sync_queue = postponed;
        ready
    }

    fn calculate_backoff(&self, attempt: u32) -> Duration {
        let multiplier = 2_u32.saturating_pow(attempt);
        let secs = self.base_backoff.as_secs().saturating_mul(multiplier as u64);
        let delay = Duration::from_secs(secs);
        if delay > self.max_backoff {
            self.max_backoff
        } else {
            delay
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sync_manager_limits_concurrent_syncs() {
        let mut manager = StateSyncManager::new();
        let now = Instant::now();

        // 5 nodes should be allowed to sync immediately
        for i in 1..=5 {
            let res = manager.request_sync(format!("node_{}", i), now);
            assert_eq!(res, Some(SyncType::Full));
        }

        // The 6th node should be queued (returns None)
        let res = manager.request_sync("node_6".to_string(), now);
        assert_eq!(res, None);
        assert_eq!(manager.sync_queue.len(), 1);
    }

    #[test]
    fn test_incremental_sync_triggered() {
        let mut manager = StateSyncManager::new();
        let now = Instant::now();

        // First sync is Full
        let res = manager.request_sync("node_1".to_string(), now);
        assert_eq!(res, Some(SyncType::Full));

        // Subsequent sync within 60s is Incremental
        let later = now + Duration::from_secs(30);
        let res2 = manager.request_sync("node_1".to_string(), later);
        assert_eq!(res2, Some(SyncType::Incremental));

        // Sync after 60s is Full again
        let much_later = later + Duration::from_secs(65);
        // Free up slot first
        manager.complete_sync();
        let res3 = manager.request_sync("node_1".to_string(), much_later);
        assert_eq!(res3, Some(SyncType::Full));
    }
}
