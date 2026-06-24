use std::collections::HashMap;
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct BackendNode {
    pub backend_id: String,
    pub address: String,
    pub is_active: bool,
    pub latency_history: Vec<(Instant, u128)>, // time and latency in ms
    pub circuit_broken: bool,
    pub broken_since: Option<Instant>,
}

pub struct BackendPool {
    pub backends: HashMap<String, BackendNode>,
    pub p99_threshold_ms: u128,
    pub duration_threshold: Duration,
}

impl BackendPool {
    pub fn new() -> Self {
        Self {
            backends: HashMap::new(),
            p99_threshold_ms: 1000,
            duration_threshold: Duration::from_secs(10),
        }
    }

    pub fn add_backend(&mut self, backend_id: String, address: String) {
        self.backends.insert(
            backend_id.clone(),
            BackendNode {
                backend_id,
                address,
                is_active: true,
                latency_history: Vec::new(),
                circuit_broken: false,
                broken_since: None,
            },
        );
    }

    pub fn record_latency(&mut self, backend_id: &str, latency_ms: u128) {
        if let Some(backend) = self.backends.get_mut(backend_id) {
            let now = Instant::now();
            backend.latency_history.push((now, latency_ms));
            
            // Clean up history older than 15s
            backend.latency_history.retain(|(t, _)| now.duration_since(*t) < Duration::from_secs(15));
            
            self.check_circuit_breaker(backend_id);
        }
    }

    fn check_circuit_breaker(&mut self, backend_id: &str) {
        let now = Instant::now();
        if let Some(backend) = self.backends.get_mut(backend_id) {
            if backend.circuit_broken {
                return;
            }

            // Get latencies in the last 10s
            let mut recent_latencies: Vec<u128> = backend
                .latency_history
                .iter()
                .filter(|(t, _)| now.duration_since(*t) <= self.duration_threshold)
                .map(|(_, l)| *l)
                .collect();

            if recent_latencies.is_empty() {
                return;
            }

            // Calculate P99 latency
            recent_latencies.sort_unstable();
            let p99_index = (recent_latencies.len() as f32 * 0.99) as usize;
            let p99_latency = recent_latencies[p99_index.min(recent_latencies.len() - 1)];

            if p99_latency > self.p99_threshold_ms {
                if let Some(first_failure_time) = backend.broken_since {
                    if now.duration_since(first_failure_time) >= self.duration_threshold {
                        backend.circuit_broken = true;
                        backend.is_active = false;
                        self.trigger_alert(backend_id, p99_latency);
                    }
                } else {
                    backend.broken_since = Some(now);
                }
            } else {
                backend.broken_since = None;
            }
        }
    }

    pub fn recover_backend(&mut self, backend_id: &str) {
        if let Some(backend) = self.backends.get_mut(backend_id) {
            backend.circuit_broken = false;
            backend.is_active = true;
            backend.broken_since = None;
            backend.latency_history.clear();
            println!("[ALERT] Backend {} recovered and added back to rotation", backend_id);
        }
    }

    fn trigger_alert(&self, backend_id: &str, p99_latency: u128) {
        println!(
            "[ALERT] CIRCUIT BREAKER TRIGGERED: Backend {} removed from rotation. P99 latency is {}ms (threshold {}ms for 10s)",
            backend_id, p99_latency, self.p99_threshold_ms
        );
    }

    pub fn get_active_backends(&self) -> Vec<BackendNode> {
        self.backends
            .values()
            .filter(|b| b.is_active)
            .cloned()
            .collect()
    }
}
