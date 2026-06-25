use std::alloc::Layout;
use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use crate::counter::FlowCounter;

enum AllocKind {
    Mmap,
    Heap,
}

pub struct MmapShard {
    pub region: NonNull<FlowCounter>,
    pub capacity: usize,
    pub lock: Mutex<()>,
    locked: AtomicBool,
    kind: AllocKind,
}

impl MmapShard {
    fn alloc(size: usize) -> (*mut u8, AllocKind) {
        #[cfg(target_os = "linux")]
        {
            const MAP_PRIVATE: i32 = 0x02;
            const MAP_ANONYMOUS: i32 = 0x20;
            const MAP_HUGETLB: i32 = 0x40000;
            const MAP_HUGE_2MB: i32 = 0x21 << 26;
            const PROT_READ: i32 = 0x1;
            const PROT_WRITE: i32 = 0x2;

            let flags = MAP_PRIVATE | MAP_ANONYMOUS | MAP_HUGETLB | MAP_HUGE_2MB;
            let prot = PROT_READ | PROT_WRITE;

            let ret = unsafe { libc::mmap(std::ptr::null_mut(), size, prot, flags, -1, 0) };

            if ret != libc::MAP_FAILED {
                return (ret as *mut u8, AllocKind::Mmap);
            }

            let err = std::io::Error::last_os_error();
            eprintln!("MAP_HUGETLB failed (falling back): {}", err);
        }

        let layout = Layout::from_size_align(size, 4096).expect("invalid heap layout");
        let ptr = unsafe { std::alloc::alloc_zeroed(layout) };
        if ptr.is_null() {
            panic!("heap allocation failed for size {}", size);
        }
        (ptr, AllocKind::Heap)
    }

    pub fn new(capacity: usize) -> Self {
        let size = capacity
            .checked_mul(FlowCounter::size())
            .expect("shard capacity overflow");
        let (ptr, kind) = Self::alloc(size);

        Self {
            region: NonNull::new(ptr as *mut FlowCounter).unwrap(),
            capacity,
            lock: Mutex::new(()),
            locked: AtomicBool::new(false),
            kind,
        }
    }

    pub fn mlock_region(&self, size: usize) {
        #[cfg(target_os = "linux")]
        {
            let ret = unsafe { libc::mlock(self.region.as_ptr() as *const libc::c_void, size) };
            if ret != 0 {
                let err = std::io::Error::last_os_error();
                eprintln!("mlock failed for shard: {}", err);
            } else {
                self.locked.store(true, Ordering::Release);
            }
        }

        #[cfg(not(target_os = "linux"))]
        {
            let _ = size;
        }
    }

    pub fn prefault(&self, size: usize) {
        let base = self.region.as_ptr() as *mut u8;
        let mut offset = 0usize;
        while offset < size {
            unsafe {
                base.add(offset).write_volatile(0u8);
            }
            offset = offset.saturating_add(4096);
        }
        let last_page_start = (size / 4096) * 4096;
        if last_page_start < size && last_page_start != 0 {
            unsafe {
                base.add(last_page_start).write_volatile(0u8);
            }
        }
    }

    pub fn counter_at(&self, index: usize) -> &FlowCounter {
        assert!(index < self.capacity, "flow index out of bounds");
        unsafe { &*self.region.as_ptr().add(index) }
    }

    pub fn is_locked(&self) -> bool {
        self.locked.load(Ordering::Acquire)
    }
}

impl Drop for MmapShard {
    fn drop(&mut self) {
        let size = self.capacity * FlowCounter::size();
        #[cfg(target_os = "linux")]
        {
            if self.locked.load(Ordering::Acquire) {
                unsafe {
                    libc::munlock(self.region.as_ptr() as *const libc::c_void, size);
                }
            }
        }
        match self.kind {
            AllocKind::Mmap => {
                #[cfg(target_os = "linux")]
                unsafe {
                    libc::munmap(self.region.as_ptr() as *mut libc::c_void, size);
                }
            }
            AllocKind::Heap => unsafe {
                std::alloc::dealloc(
                    self.region.as_ptr() as *mut u8,
                    Layout::from_size_align(size, 64).unwrap(),
                );
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shard_new_and_basic_ops() {
        let shard = MmapShard::new(100);
        assert!(shard.capacity >= 100);
        assert!(!shard.is_locked());
    }

    #[test]
    fn test_counter_at_within_bounds() {
        let shard = MmapShard::new(10);
        let counter = shard.counter_at(5);
        counter.increment(42, 99);
        let (ingress, egress) = counter.read();
        assert_eq!(ingress, 42);
        assert_eq!(egress, 99);
    }

    #[test]
    fn test_prefault_does_not_corrupt_counters() {
        let shard = MmapShard::new(10);
        let counter = shard.counter_at(3);
        counter.increment(10, 20);
        shard.prefault(10 * FlowCounter::size());
        let (ingress, egress) = counter.read();
        assert_eq!(ingress, 10);
        assert_eq!(egress, 20);
    }

    #[test]
    fn test_zeroed_after_creation() {
        let shard = MmapShard::new(50);
        for i in 0..50 {
            let (ingress, egress) = shard.counter_at(i).read();
            assert_eq!(ingress, 0);
            assert_eq!(egress, 0);
        }
    }

    #[test]
    fn test_counter_region_is_page_aligned() {
        let shard = MmapShard::new(1);
        let ptr = shard.region.as_ptr() as usize;
        assert_eq!(ptr % 4096, 0, "shard region must be page-aligned");
    }
}
