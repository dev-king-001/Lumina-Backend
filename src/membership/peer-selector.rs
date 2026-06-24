use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};

pub const DEFAULT_GOSSIP_FANOUT: usize = 3;
const REJECTION_ROUNDS: usize = 3;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Peer {
    pub id: String,
    pub ip: String,
}

pub fn select_peers(members: &[Peer], fanout: usize, seed: &[u8]) -> Vec<Peer> {
    let mut shuffled = fisher_yates_shuffle(members, seed);
    let take = fanout.min(shuffled.len());
    let mut selected: Vec<Peer> = shuffled.drain(..take).collect();
    diversify_prefixes(&mut selected, shuffled, take);
    selected
}

fn diversify_prefixes(selected: &mut Vec<Peer>, candidates: Vec<Peer>, fanout: usize) {
    for _ in 0..REJECTION_ROUNDS {
        if selected.len() < fanout {
            break;
        }

        let duplicate_index = first_duplicate_prefix(selected);
        let Some(index) = duplicate_index else { break; };
        let used_prefixes: HashSet<String> = selected
            .iter()
            .enumerate()
            .filter_map(|(i, peer)| (i != index).then(|| ipv4_16_prefix(&peer.ip)).flatten())
            .collect();

        if let Some(replacement) = candidates
            .iter()
            .find(|peer| ipv4_16_prefix(&peer.ip).map(|prefix| !used_prefixes.contains(&prefix)).unwrap_or(true))
            .cloned()
        {
            selected[index] = replacement;
        } else {
            break;
        }
    }
}

fn first_duplicate_prefix(peers: &[Peer]) -> Option<usize> {
    let mut seen: HashMap<String, usize> = HashMap::new();
    for (index, peer) in peers.iter().enumerate() {
        if let Some(prefix) = ipv4_16_prefix(&peer.ip) {
            if seen.insert(prefix, index).is_some() {
                return Some(index);
            }
        }
    }
    None
}

fn ipv4_16_prefix(ip: &str) -> Option<String> {
    let mut octets = ip.split('.');
    let first = octets.next()?.parse::<u8>().ok()?;
    let second = octets.next()?.parse::<u8>().ok()?;
    Some(format!("{first}.{second}"))
}

fn fisher_yates_shuffle<T: Clone + Hash>(items: &[T], seed: &[u8]) -> Vec<T> {
    let mut shuffled = items.to_vec();
    let mut state = seed_to_u64(seed);
    for i in (1..shuffled.len()).rev() {
        state = xorshift64(state);
        let j = (state as usize) % (i + 1);
        shuffled.swap(i, j);
    }
    shuffled
}

fn seed_to_u64(seed: &[u8]) -> u64 {
    if seed.is_empty() {
        return 0x9e37_79b9_7f4a_7c15;
    }
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    seed.hash(&mut hasher);
    hasher.finish()
}

fn xorshift64(mut x: u64) -> u64 {
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    x
}
