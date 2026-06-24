import { BackoffScheduler } from '../src/utils/backoff-scheduler';
import { JoinHandler } from '../src/membership/join-handler';
import { MemberList, MemberStatus, Member } from '../src/membership/member-list';
import { GossipProtocol, BloomFilter256 } from '../src/membership/gossip-protocol';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function testBackoffScheduler() {
  console.log('Testing BackoffScheduler...');
  const scheduler = new BackoffScheduler(1000, 30000);
  assert(scheduler.getDelay(0) === 1000, 'Attempt 0 should be 1000ms');
  assert(scheduler.getDelay(1) === 2000, 'Attempt 1 should be 2000ms');
  assert(scheduler.getDelay(5) === 30000, 'Attempt 5 should be capped at 30000ms');
  console.log('BackoffScheduler tests passed.');
}

function testJoinHandler() {
  console.log('Testing JoinHandler...');
  const scheduler = new BackoffScheduler(1000, 30000);
  const joinHandler = new JoinHandler(scheduler);

  // Less than 5 joins => throttle factor 1.0
  for (let i = 0; i < 4; i++) {
    joinHandler.recordJoin();
  }
  assert(joinHandler.getThrottleFactor() === 1.0, 'Throttle factor should be 1.0 for 4 nodes');

  // 5 joins => throttle factor 1.0
  joinHandler.recordJoin();
  assert(joinHandler.getThrottleFactor() === 1.0, 'Throttle factor should be 1.0 for 5 nodes');

  // 6 joins => throttle factor 2.0
  joinHandler.recordJoin();
  assert(joinHandler.getThrottleFactor() === 2.0, 'Throttle factor should be 2.0 for 6 nodes');

  // 7 joins => throttle factor 4.0
  joinHandler.recordJoin();
  assert(joinHandler.getThrottleFactor() === 4.0, 'Throttle factor should be 4.0 for 7 nodes');

  console.log('JoinHandler tests passed.');
}

function testMemberList() {
  console.log('Testing MemberList...');
  const list = new MemberList();
  
  const m1: Member = { id: 'n1', address: '127.0.0.1:8000', status: MemberStatus.Alive, incarnation: 1, lastUpdated: Date.now() };
  list.addOrUpdateMember(m1);
  assert(list.getMember('n1')?.incarnation === 1, 'Member incarnation should be 1');

  // Higher incarnation overrides
  const m2: Member = { id: 'n1', address: '127.0.0.1:8000', status: MemberStatus.Suspect, incarnation: 2, lastUpdated: Date.now() };
  list.addOrUpdateMember(m2);
  assert(list.getMember('n1')?.incarnation === 2, 'Incarnation should update to 2');
  assert(list.getMember('n1')?.status === MemberStatus.Suspect, 'Status should update to Suspect');

  // Dead overrides Suspect at same incarnation
  const m3: Member = { id: 'n1', address: '127.0.0.1:8000', status: MemberStatus.Dead, incarnation: 2, lastUpdated: Date.now() };
  list.addOrUpdateMember(m3);
  assert(list.getMember('n1')?.status === MemberStatus.Dead, 'Status should update to Dead');

  console.log('MemberList tests passed.');
}

function testGossipProtocol() {
  console.log('Testing GossipProtocol...');
  const list = new MemberList();
  const gossip = new GossipProtocol('self', list);

  // Add some members
  list.addOrUpdateMember({ id: 'self', address: '127.0.0.1:8000', status: MemberStatus.Alive, incarnation: 1, lastUpdated: Date.now() });
  list.addOrUpdateMember({ id: 'peer1', address: '127.0.0.1:8001', status: MemberStatus.Alive, incarnation: 1, lastUpdated: Date.now() });
  list.addOrUpdateMember({ id: 'peer2', address: '127.0.0.1:8002', status: MemberStatus.Alive, incarnation: 1, lastUpdated: Date.now() });
  list.addOrUpdateMember({ id: 'peer3', address: '127.0.0.1:8003', status: MemberStatus.Alive, incarnation: 1, lastUpdated: Date.now() });

  // Disseminate update
  const updatedMember: Member = { id: 'peer1', address: '127.0.0.1:8001', status: MemberStatus.Suspect, incarnation: 2, lastUpdated: Date.now() };
  gossip.disseminateUpdate(updatedMember);
  assert(gossip.sentMessages.length <= 3, 'Gossip fan-out should send up to 3 messages');

  // Bloom Filter verification
  const filter = new BloomFilter256();
  filter.add('self');
  filter.add('peer1');
  assert(filter.has('self'), 'Bloom filter should contain self');
  assert(filter.has('peer1'), 'Bloom filter should contain peer1');
  assert(!filter.has('peer99'), 'Bloom filter should not contain peer99');

  console.log('GossipProtocol tests passed.');
}

function runAll() {
  testBackoffScheduler();
  testJoinHandler();
  testMemberList();
  testGossipProtocol();
  console.log('All TypeScript membership tests passed successfully!');
}

runAll();
