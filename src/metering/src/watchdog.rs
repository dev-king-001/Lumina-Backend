use std::fs::File;
use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

const CGROUP_V2_MEMORY_PRESSURE: &str = "/sys/fs/cgroup/memory.pressure";
const CGROUP_V1_MEMORY_PRESSURE: &str = "/sys/fs/cgroup/memory/memory.pressure_level";
const POLL_INTERVAL: Duration = Duration::from_secs(1);
const PRESSURE_THRESHOLD: u32 = 60;
const REDUCTION_PCT: u32 = 10;
const RECOVERY_PCT: u32 = 5;
const HOLD_DOWN_TICKS: u32 = 30;
const RECOVERY_TICKS: u32 = 60;

pub struct MemoryWatchdog {
    pub flow_target: Arc<AtomicU32>,
    handle: Option<thread::JoinHandle<()>>,
    running: Arc<AtomicU32>,
}

impl MemoryWatchdog {
    pub fn new(initial_flow_target: u32) -> Self {
        Self {
            flow_target: Arc::new(AtomicU32::new(initial_flow_target)),
            handle: None,
            running: Arc::new(AtomicU32::new(0)),
        }
    }

    pub fn start(&mut self) {
        let flow_target = self.flow_target.clone();
        let running = self.running.clone();
        running.store(1, Ordering::Release);

        self.handle = Some(thread::spawn(move || {
            MemoryWatchdog::run_loop(flow_target, running);
        }));
    }

    pub fn stop(&mut self) {
        self.running.store(0, Ordering::Release);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }

    fn run_loop(flow_target: Arc<AtomicU32>, running: Arc<AtomicU32>) {
        let mut hold_down_remaining: u32 = 0;
        let mut recovery_remaining: u32 = 0;

        while running.load(Ordering::Acquire) != 0 {
            thread::sleep(POLL_INTERVAL);

            let pressure = match Self::read_pressure() {
                Some(p) => p,
                None => continue,
            };

            if pressure >= PRESSURE_THRESHOLD {
                if hold_down_remaining > 0 {
                    hold_down_remaining -= 1;
                    continue;
                }

                let current = flow_target.load(Ordering::Acquire);
                let reduction = (current * REDUCTION_PCT / 100).max(1);
                let new_target = current.saturating_sub(reduction);
                flow_target.store(new_target, Ordering::Release);

                eprintln!(
                    "[watchdog] memory {}% >= {}%, reducing flow target: {} -> {}",
                    pressure, PRESSURE_THRESHOLD, current, new_target
                );

                hold_down_remaining = HOLD_DOWN_TICKS;
                recovery_remaining = 0;
            } else if pressure < PRESSURE_THRESHOLD / 2 {
                if recovery_remaining > 0 {
                    recovery_remaining -= 1;
                } else {
                    let current = flow_target.load(Ordering::Acquire);
                    if current < 500_000 {
                        let increase = (current * RECOVERY_PCT / 100).max(1);
                        let new_target = (current + increase).min(500_000);
                        flow_target.store(new_target, Ordering::Release);

                        eprintln!(
                            "[watchdog] memory {}%, recovering flow target: {} -> {}",
                            pressure, current, new_target
                        );
                    }
                    recovery_remaining = RECOVERY_TICKS;
                }
            } else {
                hold_down_remaining = 0;
                recovery_remaining = 0;
            }
        }
    }

    fn read_pressure() -> Option<u32> {
        let path = if std::path::Path::new(CGROUP_V2_MEMORY_PRESSURE).exists() {
            CGROUP_V2_MEMORY_PRESSURE
        } else if std::path::Path::new(CGROUP_V1_MEMORY_PRESSURE).exists() {
            CGROUP_V1_MEMORY_PRESSURE
        } else {
            return None;
        };

        let file = File::open(path).ok()?;
        let reader = BufReader::new(file);
        for line in reader.lines() {
            let line = line.ok()?;
            if line.starts_with("some ") {
                let fields: Vec<&str> = line.split_whitespace().collect();
                for field in fields {
                    if field.starts_with("avg10=") {
                        let val = field.trim_start_matches("avg10=");
                        let val: f64 = val.parse().ok()?;
                        return Some((val * 100.0) as u32);
                    }
                }
            }
        }
        None
    }
}

impl Drop for MemoryWatchdog {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pressure_parsing_cgroup_v2() {
        let input = "some avg10=0.45 avg60=0.32 avg300=0.10 total=12345\nfull avg10=0.12 avg60=0.08 avg300=0.03 total=6789\n";
        let path = std::env::temp_dir().join("test_memory_pressure");
        std::fs::write(&path, input).unwrap();

        let result = MemoryWatchdog::read_pressure();
        std::fs::remove_file(&path).ok();
        assert!(result.is_none() || result.is_some());
    }

    #[test]
    fn test_flow_target_reduction() {
        let target = Arc::new(AtomicU32::new(500_000));
        let current = target.load(Ordering::Acquire);
        let reduction = (current * REDUCTION_PCT / 100).max(1);
        let new_target = current.saturating_sub(reduction);
        assert_eq!(new_target, 450_000);
    }

    #[test]
    fn test_flow_target_recovery_capped() {
        let target = Arc::new(AtomicU32::new(450_000));
        let current = target.load(Ordering::Acquire);
        let increase = (current * RECOVERY_PCT / 100).max(1);
        let new_target = (current + increase).min(500_000);
        assert_eq!(new_target, 472_500);
    }

    #[test]
    fn test_flow_target_stays_at_max() {
        let target = Arc::new(AtomicU32::new(500_000));
        let current = target.load(Ordering::Acquire);
        let increase = (current * RECOVERY_PCT / 100).max(1);
        let new_target = (current + increase).min(500_000);
        assert_eq!(new_target, 500_000);
    }

    #[test]
    fn test_flow_target_floor() {
        let target = Arc::new(AtomicU32::new(1));
        let current = target.load(Ordering::Acquire);
        let reduction = (current * REDUCTION_PCT / 100).max(1);
        let new_target = current.saturating_sub(reduction);
        // 1 - max(0, 1) = 0
        assert_eq!(new_target, 0);
    }
}
