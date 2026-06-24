use crate::counter::FlowCounter;
use crate::shard::MmapShard;

const NUM_SHARDS: usize = 64;
const MAX_FLOWS: usize = 500_000;
const FLOWS_PER_SHARD: usize = (MAX_FLOWS + NUM_SHARDS - 1) / NUM_SHARDS;
const SHARD_BYTES: usize = FLOWS_PER_SHARD * FlowCounter::size();

pub struct ShardedCounterStore {
    shards: [MmapShard; NUM_SHARDS],
}

impl ShardedCounterStore {
    pub fn new() -> Self {
        let mut shards: [std::mem::MaybeUninit<MmapShard>; NUM_SHARDS] =
            unsafe { std::mem::zeroed() };

        for (i, slot) in shards.iter_mut().enumerate() {
            let shard = MmapShard::new(FLOWS_PER_SHARD);
            shard.mlock_region(SHARD_BYTES);
            shard.prefault(SHARD_BYTES);
            *slot = std::mem::MaybeUninit::new(shard);
            log_shard_init(i, SHARD_BYTES, shard.is_locked());
        }

        Self {
            shards: unsafe { std::mem::transmute(shards) },
        }
    }

    pub fn increment(&self, flow_id: u64, ingress_bytes: u64, egress_bytes: u64) {
        let shard_id = self.shard_index(flow_id);
        let offset = self.shard_offset(flow_id);
        self.shards[shard_id]
            .counter_at(offset)
            .increment(ingress_bytes, egress_bytes);
    }

    pub fn read_counter(&self, flow_id: u64) -> (u64, u64) {
        let shard_id = self.shard_index(flow_id);
        let offset = self.shard_offset(flow_id);
        self.shards[shard_id].counter_at(offset).read()
    }

    pub fn reset_counter(&self, flow_id: u64) -> (u64, u64) {
        let shard_id = self.shard_index(flow_id);
        let offset = self.shard_offset(flow_id);
        self.shards[shard_id].counter_at(offset).reset()
    }

    pub fn snapshot_shard(&self, shard_id: usize) -> Vec<(u64, u64, u64)> {
        assert!(shard_id < NUM_SHARDS, "shard_id out of bounds");
        let shard = &self.shards[shard_id];
        let _guard = shard.lock.lock().unwrap();

        let base = shard_id as u64 * FLOWS_PER_SHARD as u64;
        let mut result = Vec::with_capacity(FLOWS_PER_SHARD);
        for i in 0..FLOWS_PER_SHARD {
            let (ingress, egress) = shard.counter_at(i).read();
            if ingress > 0 || egress > 0 {
                result.push((base + i as u64, ingress, egress));
            }
        }
        result
    }

    pub fn reset_shard(&self, shard_id: usize) -> Vec<(u64, u64, u64)> {
        assert!(shard_id < NUM_SHARDS, "shard_id out of bounds");
        let shard = &self.shards[shard_id];
        let _guard = shard.lock.lock().unwrap();

        let base = shard_id as u64 * FLOWS_PER_SHARD as u64;
        let mut result = Vec::with_capacity(FLOWS_PER_SHARD);
        for i in 0..FLOWS_PER_SHARD {
            let (ingress, egress) = shard.counter_at(i).reset();
            if ingress > 0 || egress > 0 {
                result.push((base + i as u64, ingress, egress));
            }
        }
        result
    }

    pub fn total_memory(&self) -> usize {
        NUM_SHARDS * SHARD_BYTES
    }

    pub fn shard_count(&self) -> usize {
        NUM_SHARDS
    }

    pub fn flows_per_shard(&self) -> usize {
        FLOWS_PER_SHARD
    }

    pub fn num_shards(&self) -> usize {
        NUM_SHARDS
    }

    fn shard_index(&self, flow_id: u64) -> usize {
        (flow_id as usize) % NUM_SHARDS
    }

    fn shard_offset(&self, flow_id: u64) -> usize {
        (flow_id as usize / NUM_SHARDS) % FLOWS_PER_SHARD
    }
}

fn log_shard_init(shard_id: usize, bytes: usize, locked: bool) {
    let status = if locked { "locked" } else { "unlocked" };
    println!(
        "[metering] shard {}: {} bytes allocated ({}), {} flows",
        shard_id, bytes, status, FLOWS_PER_SHARD
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_store_creation() {
        let store = ShardedCounterStore::new();
        assert_eq!(store.shard_count(), 64);
        assert_eq!(store.flows_per_shard(), FLOWS_PER_SHARD);
        assert_eq!(store.total_memory(), 64 * FLOWS_PER_SHARD * 64);
    }

    #[test]
    fn test_increment_round_trip() {
        let store = ShardedCounterStore::new();
        store.increment(0, 100, 200);
        let (i, e) = store.read_counter(0);
        assert_eq!(i, 100);
        assert_eq!(e, 200);
    }

    #[test]
    fn test_shard_routing_different_flows() {
        let store = ShardedCounterStore::new();
        store.increment(0, 10, 20);
        store.increment(64, 30, 40);
        assert_eq!(store.read_counter(0), (10, 20));
        assert_eq!(store.read_counter(64), (30, 40));
    }

    #[test]
    fn test_reset_counter() {
        let store = ShardedCounterStore::new();
        store.increment(42, 500, 1000);
        let (i, e) = store.reset_counter(42);
        assert_eq!(i, 500);
        assert_eq!(e, 1000);
        let (i, e) = store.read_counter(42);
        assert_eq!(i, 0);
        assert_eq!(e, 0);
    }

    #[test]
    fn test_snapshot_shard_only_returns_non_zero() {
        let store = ShardedCounterStore::new();
        store.increment(0, 1, 2);
        store.increment(1, 3, 4);
        let snapshot = store.snapshot_shard(0);
        assert!(snapshot.len() >= 2);
        assert!(snapshot
            .iter()
            .any(|(id, i, e)| *id == 0 && *i == 1 && *e == 2));
        assert!(snapshot
            .iter()
            .any(|(id, i, e)| *id == 1 && *i == 3 && *e == 4));
    }

    #[test]
    fn test_high_flow_id_routing() {
        let store = ShardedCounterStore::new();
        store.increment(499_999, 777, 888);
        let (i, e) = store.read_counter(499_999);
        assert_eq!(i, 777);
        assert_eq!(e, 888);
    }

    #[test]
    fn test_concurrent_access_different_shards() {
        use std::sync::Arc;
        use std::thread;
        let store = Arc::new(ShardedCounterStore::new());
        let mut handles = vec![];
        for flow in 0..64 {
            let s = store.clone();
            handles.push(thread::spawn(move || {
                for _ in 0..1000 {
                    s.increment(flow, 1, 1);
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        for flow in 0..64 {
            let (i, e) = store.read_counter(flow);
            assert_eq!(i, 1000, "flow {} ingress mismatch", flow);
            assert_eq!(e, 1000, "flow {} egress mismatch", flow);
        }
    }
}
