#[macro_use]
extern crate napi_derive;

mod counter;
mod shard;
mod store;
mod watchdog;

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use napi::bindgen_prelude::*;
use napi::Error;

use store::ShardedCounterStore;
use watchdog::MemoryWatchdog;

const MAX_FLOWS: u32 = 500_000;
const DEFAULT_BATCH_CAPACITY: usize = 1024;

#[napi]
pub struct MmapCounterStore {
    store: Arc<ShardedCounterStore>,
    flow_target: Arc<AtomicU32>,
    _watchdog: Option<MemoryWatchdog>,
}

#[napi]
impl MmapCounterStore {
    #[napi(constructor)]
    pub fn new(enable_watchdog: Option<bool>) -> Result<Self> {
        let store = Arc::new(ShardedCounterStore::new());
        let flow_target = Arc::new(AtomicU32::new(MAX_FLOWS));
        let mut watchdog = None;

        if enable_watchdog.unwrap_or(true) {
            let mut wd = MemoryWatchdog::new(MAX_FLOWS);
            wd.flow_target = flow_target.clone();
            wd.start();
            watchdog = Some(wd);
        }

        Ok(Self {
            store,
            flow_target,
            _watchdog: watchdog,
        })
    }

    #[napi]
    pub fn increment(&self, flow_id: u64, ingress_bytes: u64, egress_bytes: u64) {
        self.store.increment(flow_id, ingress_bytes, egress_bytes);
    }

    #[napi]
    pub fn batch_increment(
        &self,
        flows: Buffer,
        ingress_bytes: Buffer,
        egress_bytes: Buffer,
    ) -> Result<()> {
        let len = flows.len() / 8;
        if len == 0 {
            return Ok(());
        }

        let flows_slice: &[u8] = &flows;
        let ingress_slice: &[u8] = &ingress_bytes;
        let egress_slice: &[u8] = &egress_bytes;

        for i in 0..len {
            let offset = i * 8;
            if offset + 8 > flows_slice.len()
                || offset + 8 > ingress_slice.len()
                || offset + 8 > egress_slice.len()
            {
                return Err(Error::from_reason("buffer too short for batch data"));
            }

            let flow_id = u64::from_ne_bytes(flows_slice[offset..offset + 8].try_into().unwrap());
            let ingress = u64::from_ne_bytes(ingress_slice[offset..offset + 8].try_into().unwrap());
            let egress = u64::from_ne_bytes(egress_slice[offset..offset + 8].try_into().unwrap());

            self.store.increment(flow_id, ingress, egress);
        }

        Ok(())
    }

    #[napi]
    pub fn read_counter(&self, flow_id: u64) -> Vec<u64> {
        let (i, e) = self.store.read_counter(flow_id);
        vec![i, e]
    }

    #[napi]
    pub fn reset_counter(&self, flow_id: u64) -> Vec<u64> {
        let (i, e) = self.store.reset_counter(flow_id);
        vec![i, e]
    }

    #[napi]
    pub fn snapshot_shard(&self, shard_id: u32) -> Vec<Vec<u64>> {
        let entries = self.store.snapshot_shard(shard_id as usize);
        entries
            .into_iter()
            .map(|(id, ingress, egress)| vec![id, ingress, egress])
            .collect()
    }

    #[napi]
    pub fn reset_shard(&self, shard_id: u32) -> Vec<Vec<u64>> {
        let entries = self.store.reset_shard(shard_id as usize);
        entries
            .into_iter()
            .map(|(id, ingress, egress)| vec![id, ingress, egress])
            .collect()
    }

    #[napi]
    pub fn flow_target(&self) -> u32 {
        self.flow_target.load(Ordering::Acquire)
    }

    #[napi]
    pub fn total_memory(&self) -> u32 {
        self.store.total_memory() as u32
    }

    #[napi]
    pub fn shard_count(&self) -> u32 {
        self.store.shard_count() as u32
    }

    #[napi]
    pub fn flows_per_shard(&self) -> u32 {
        self.store.flows_per_shard() as u32
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;

    #[test]
    fn test_create_store() {
        let store = MmapCounterStore::new(Some(false)).unwrap();
        assert_eq!(store.shard_count(), 64);
        assert!(store.total_memory() > 0);
    }

    #[test]
    fn test_increment_and_read() {
        let store = MmapCounterStore::new(Some(false)).unwrap();
        store.increment(42, 100, 200);
        let result = store.read_counter(42);
        assert_eq!(result, vec![100, 200]);
    }

    #[test]
    fn test_batch_increment() {
        let store = MmapCounterStore::new(Some(false)).unwrap();

        let flows = vec![0u64, 1u64, 2u64];
        let ingress = vec![10u64, 20u64, 30u64];
        let egress = vec![100u64, 200u64, 300u64];

        let flows_bytes: Vec<u8> = flows.iter().flat_map(|v| v.to_ne_bytes()).collect();
        let ingress_bytes: Vec<u8> = ingress.iter().flat_map(|v| v.to_ne_bytes()).collect();
        let egress_bytes: Vec<u8> = egress.iter().flat_map(|v| v.to_ne_bytes()).collect();

        store
            .batch_increment(
                Buffer::from(flows_bytes),
                Buffer::from(ingress_bytes),
                Buffer::from(egress_bytes),
            )
            .unwrap();

        assert_eq!(store.read_counter(0), vec![10, 100]);
        assert_eq!(store.read_counter(1), vec![20, 200]);
        assert_eq!(store.read_counter(2), vec![30, 300]);
    }

    #[test]
    fn test_snapshot_shard() {
        let store = MmapCounterStore::new(Some(false)).unwrap();
        store.increment(0, 5, 10);
        store.increment(1, 15, 20);

        let snapshot = store.snapshot_shard(0);
        assert!(!snapshot.is_empty());
        assert!(snapshot.iter().any(|entry| entry == &vec![0, 5, 10]));
        assert!(snapshot.iter().any(|entry| entry == &vec![1, 15, 20]));
    }

    #[test]
    fn test_reset_counter() {
        let store = MmapCounterStore::new(Some(false)).unwrap();
        store.increment(99, 1000, 2000);
        let before = store.reset_counter(99);
        assert_eq!(before, vec![1000, 2000]);
        let after = store.read_counter(99);
        assert_eq!(after, vec![0, 0]);
    }

    #[test]
    fn test_flow_target_default() {
        let store = MmapCounterStore::new(Some(false)).unwrap();
        assert_eq!(store.flow_target(), 500_000);
    }

    #[test]
    fn test_flows_per_shard_calculation() {
        let store = MmapCounterStore::new(Some(false)).unwrap();
        let fpd = store.flows_per_shard() as u64;
        assert!(fpd * 64 >= 500_000);
    }
}
