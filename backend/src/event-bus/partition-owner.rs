use std::collections::{HashMap, VecDeque};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PartitionMessage {
    pub flow_id: String,
    pub partition: u16,
    pub seqno: u64,
    pub payload: Vec<u8>,
}

#[derive(Debug, Default)]
pub struct PartitionOwner {
    fence_tokens: HashMap<u16, String>,
    buffers: HashMap<u16, VecDeque<PartitionMessage>>,
}

impl PartitionOwner {
    pub fn activate_fence(&mut self, partition: u16, token: impl Into<String>) {
        self.fence_tokens.insert(partition, token.into());
    }

    pub fn confirm_fence(&self, partition: u16, token: &str) -> bool {
        self.fence_tokens
            .get(&partition)
            .map(|active| active == token)
            .unwrap_or(false)
    }

    pub fn append(&mut self, message: PartitionMessage) -> Result<(), &'static str> {
        if self.fence_tokens.contains_key(&message.partition) {
            return Err("partition is fenced for rebalance");
        }
        self.buffers
            .entry(message.partition)
            .or_default()
            .push_back(message);
        Ok(())
    }

    pub fn drain(
        &mut self,
        partition: u16,
        token: &str,
    ) -> Result<Vec<PartitionMessage>, &'static str> {
        if !self.confirm_fence(partition, token) {
            return Err("missing active fence token");
        }
        let drained = self
            .buffers
            .remove(&partition)
            .unwrap_or_default()
            .into_iter()
            .collect();
        Ok(drained)
    }

    pub fn release_fence(&mut self, partition: u16, token: &str) -> Result<(), &'static str> {
        if !self.confirm_fence(partition, token) {
            return Err("cannot release a different fence token");
        }
        self.fence_tokens.remove(&partition);
        Ok(())
    }
}
