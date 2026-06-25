use std::net::Ipv4Addr;

pub struct FlowTuple {
    pub src_ip: Ipv4Addr,
    pub dst_ip: Ipv4Addr,
    pub src_port: u16,
    pub dst_port: u16,
    pub protocol: u8,
}

pub struct CanonicalFlowTuple {
    pub src_tuple_a: Ipv4Addr,
    pub src_tuple_b: Ipv4Addr,
    pub port_a: u16,
    pub port_b: u16,
    pub protocol: u8,
}

impl CanonicalFlowTuple {
    pub fn new(flow: &FlowTuple) -> Self {
        let is_swapped = flow.src_ip > flow.dst_ip;
        if is_swapped {
            Self {
                src_tuple_a: flow.dst_ip,
                src_tuple_b: flow.src_ip,
                port_a: flow.dst_port,
                port_b: flow.src_port,
                protocol: flow.protocol,
            }
        } else {
            Self {
                src_tuple_a: flow.src_ip,
                src_tuple_b: flow.dst_ip,
                port_a: flow.src_port,
                port_b: flow.dst_port,
                protocol: flow.protocol,
            }
        }
    }
}

pub fn capture_and_parse(nic_id: u32, flow: &FlowTuple, _byte_length: u64) {
    let canonical = CanonicalFlowTuple::new(flow);
    
    // Flow-consistency verifier: check if canonical mapping swapped the IPs
    if flow.src_ip != canonical.src_tuple_a {
        // Emit telemetry event indicating asymmetric routing mismatch relative to canonical
        println!("[TELEMETRY] Asymmetric routing fingerprint mismatch on NIC {}: Original src {} canonical src {}", 
                 nic_id, flow.src_ip, canonical.src_tuple_a);
    }
}
