use std::time::{Duration, Instant};
use std::sync::{Arc, Mutex};
use std::thread;

// Technical Invariants & Bounds
const LB_PROBE_INTERVAL_S: u64 = 15;
const HEALTH_SCORE_WINDOW: usize = 5;
const LATENCY_SPIKE_THRESHOLD_MS: u128 = 200;

#[derive(Debug, Clone)]
pub struct ProbeSample {
    pub timestamp: Instant,
    pub latency_ms: u128,
    pub success: bool,
}

#[derive(Debug, Clone)]
pub struct BackendHealth {
    pub backend_id: String,
    pub health_score: u8, // 0 to 100
    pub samples: Vec<ProbeSample>,
    pub is_degraded: bool,
}

pub struct HealthProber {
    pub backends: Arc<Mutex<Vec<BackendHealth>>>,
    pub update_sender: std::sync::mpsc::Sender<BackendHealth>,
}

impl HealthProber {
    pub fn new(backends: Vec<String>, update_sender: std::sync::mpsc::Sender<BackendHealth>) -> Self {
        let backend_healths = backends.into_iter().map(|id| BackendHealth {
            backend_id: id,
            health_score: 100,
            samples: Vec::new(),
            is_degraded: false,
        }).collect();

        Self {
            backends: Arc::new(Mutex::new(backend_healths)),
            update_sender,
        }
    }

    // Event-driven health update triggered immediately by latency spikes > 200ms
    pub fn report_request_latency(&self, backend_id: &str, latency_ms: u128) {
        if latency_ms > LATENCY_SPIKE_THRESHOLD_MS {
            let mut backends = self.backends.lock().unwrap();
            if let Some(backend) = backends.iter_mut().find(|b| b.backend_id == backend_id) {
                let sample = ProbeSample {
                    timestamp: Instant::now(),
                    latency_ms,
                    success: true,
                };
                backend.samples.push(sample);
                if backend.samples.len() > HEALTH_SCORE_WINDOW {
                    backend.samples.remove(0);
                }

                // Immediately recalculate health score due to event-driven spike
                let penalty = ((latency_ms - LATENCY_SPIKE_THRESHOLD_MS) / 50) as u8;
                backend.health_score = backend.health_score.saturating_sub(penalty.max(10)).max(0);
                backend.is_degraded = true;

                // Push update immediately instead of waiting for next probe cycle
                let _ = self.update_sender.send(backend.clone());
            }
        }
    }

    // Periodic health check loop
    pub fn start_probing(&self) {
        let backends_clone = Arc::clone(&self.backends);
        let sender_clone = self.update_sender.clone();

        thread::spawn(move || {
            loop {
                thread::sleep(Duration::from_secs(LB_PROBE_INTERVAL_S));
                let mut backends = backends_clone.lock().unwrap();
                for backend in backends.iter_mut() {
                    let success = true; // perform actual HTTP/TCP health check
                    let latency_ms = 10; // Mock base latency
                    
                    let sample = ProbeSample {
                        timestamp: Instant::now(),
                        latency_ms,
                        success,
                    };
                    backend.samples.push(sample);
                    if backend.samples.len() > HEALTH_SCORE_WINDOW {
                        backend.samples.remove(0);
                    }

                    let success_count = backend.samples.iter().filter(|s| s.success).count();
                    let success_ratio = success_count as f32 / backend.samples.len() as f32;
                    let base_score = (success_ratio * 100.0) as u8;

                    let avg_latency: u128 = backend.samples.iter().map(|s| s.latency_ms).sum::<u128>() / backend.samples.len() as u128;
                    let penalty = if avg_latency > LATENCY_SPIKE_THRESHOLD_MS {
                        ((avg_latency - LATENCY_SPIKE_THRESHOLD_MS) / 20) as u8
                    } else {
                        0
                    };

                    backend.health_score = base_score.saturating_sub(penalty);
                    backend.is_degraded = backend.health_score < 100;

                    let _ = sender_clone.send(backend.clone());
                }
            }
        });
    }
}
