use std::sync::atomic::{AtomicU64, Ordering};

pub const FLOW_COUNTER_SIZE: usize = 64;
const INGRESS_OFFSET: usize = 0;
const EGRESS_OFFSET: usize = 8;
const PADDING_SIZE: usize = 48;

#[repr(C, align(64))]
pub struct FlowCounter {
    ingress: AtomicU64,
    egress: AtomicU64,
    _pad: [u8; PADDING_SIZE],
}

impl FlowCounter {
    pub fn new() -> Self {
        Self {
            ingress: AtomicU64::new(0),
            egress: AtomicU64::new(0),
            _pad: [0u8; PADDING_SIZE],
        }
    }

    pub fn increment_ingress(&self, bytes: u64) {
        self.ingress.fetch_add(bytes, Ordering::Relaxed);
    }

    pub fn increment_egress(&self, bytes: u64) {
        self.egress.fetch_add(bytes, Ordering::Relaxed);
    }

    pub fn increment(&self, ingress_bytes: u64, egress_bytes: u64) {
        if ingress_bytes > 0 {
            self.ingress.fetch_add(ingress_bytes, Ordering::Relaxed);
        }
        if egress_bytes > 0 {
            self.egress.fetch_add(egress_bytes, Ordering::Relaxed);
        }
    }

    pub fn read(&self) -> (u64, u64) {
        let ingress = self.ingress.load(Ordering::Relaxed);
        let egress = self.egress.load(Ordering::Relaxed);
        (ingress, egress)
    }

    pub fn reset(&self) -> (u64, u64) {
        let ingress = self.ingress.swap(0, Ordering::Relaxed);
        let egress = self.egress.swap(0, Ordering::Relaxed);
        (ingress, egress)
    }

    pub fn as_bytes(&self) -> &[u8; FLOW_COUNTER_SIZE] {
        let ptr = self as *const Self as *const [u8; FLOW_COUNTER_SIZE];
        unsafe { &*ptr }
    }

    pub const fn size() -> usize {
        FLOW_COUNTER_SIZE
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_counter_size() {
        assert_eq!(std::mem::size_of::<FlowCounter>(), 64);
        assert_eq!(std::mem::align_of::<FlowCounter>(), 64);
    }

    #[test]
    fn test_increment_and_read() {
        let counter = FlowCounter::new();
        counter.increment(100, 200);
        let (ingress, egress) = counter.read();
        assert_eq!(ingress, 100);
        assert_eq!(egress, 200);
    }

    #[test]
    fn test_reset() {
        let counter = FlowCounter::new();
        counter.increment(50, 75);
        let (ingress, egress) = counter.reset();
        assert_eq!(ingress, 50);
        assert_eq!(egress, 75);
        let (ingress, egress) = counter.read();
        assert_eq!(ingress, 0);
        assert_eq!(egress, 0);
    }

    #[test]
    fn test_increment_both_directions_independently() {
        let counter = FlowCounter::new();
        counter.increment_ingress(10);
        counter.increment_egress(20);
        let (ingress, egress) = counter.read();
        assert_eq!(ingress, 10);
        assert_eq!(egress, 20);
    }

    #[test]
    fn test_zero_increment_no_op() {
        let counter = FlowCounter::new();
        counter.increment(0, 0);
        let (ingress, egress) = counter.read();
        assert_eq!(ingress, 0);
        assert_eq!(egress, 0);
    }

    #[test]
    fn test_concurrent_increments() {
        use std::sync::Arc;
        use std::thread;
        let counter = Arc::new(FlowCounter::new());
        let mut handles = vec![];
        for _ in 0..8 {
            let c = counter.clone();
            handles.push(thread::spawn(move || {
                for _ in 0..10000 {
                    c.increment(1, 1);
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        let (ingress, egress) = counter.read();
        assert_eq!(ingress, 80000);
        assert_eq!(egress, 80000);
    }

    #[test]
    fn test_offset_constants() {
        let c = FlowCounter::new();
        let base = &c as *const _ as usize;
        let ingress_ptr = &c.ingress as *const _ as usize;
        let egress_ptr = &c.egress as *const _ as usize;
        assert_eq!(ingress_ptr - base, INGRESS_OFFSET);
        assert_eq!(egress_ptr - base, EGRESS_OFFSET);
    }
}
