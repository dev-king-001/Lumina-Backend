pub struct PortExhaustionWatchdog {
    pub port_utilization: f64,
    pub emergency_mode: bool,
}

impl PortExhaustionWatchdog {
    pub fn new() -> Self {
        Self {
            port_utilization: 0.0,
            emergency_mode: false,
        }
    }

    pub fn update_utilization(&mut self, utilization: f64) {
        self.port_utilization = utilization;
        
        // Add a port-utilization alarm that triggers emergency connection reuse mode 
        // (force close idle connections, reduce max streams per connection) when utilization exceeds 80%
        if self.port_utilization > 0.80 {
            self.trigger_emergency_mode();
        } else {
            self.emergency_mode = false;
        }
    }
    
    fn trigger_emergency_mode(&mut self) {
        self.emergency_mode = true;
        println!("ALARM: Port utilization exceeded 80%! Triggering emergency connection reuse mode.");
    }
}
