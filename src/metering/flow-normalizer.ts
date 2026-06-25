export interface FlowTuple {
  srcIp: string;
  dstIp: string;
  srcPort: number;
  dstPort: number;
  protocol: string;
}

export interface CanonicalFlowTuple {
  srcTupleA: string;
  srcTupleB: string;
  portA: number;
  portB: number;
  protocol: string;
  isIngress: boolean;
}

/**
 * Normalizes a flow tuple so that the IP pair is sorted.
 * The lower IP is always srcTupleA and the higher IP is srcTupleB.
 * This ensures ingress and egress produce identical hash keys.
 */
export function normalizeFlow(flow: FlowTuple): CanonicalFlowTuple {
  const isSwapped = flow.srcIp > flow.dstIp;

  return {
    srcTupleA: isSwapped ? flow.dstIp : flow.srcIp,
    srcTupleB: isSwapped ? flow.srcIp : flow.dstIp,
    portA: isSwapped ? flow.dstPort : flow.srcPort,
    portB: isSwapped ? flow.srcPort : flow.dstPort,
    protocol: flow.protocol,
    isIngress: !isSwapped, // We treat non-swapped as ingress direction relative to canonical
  };
}

/**
 * Generates a consistent hash string for the canonical flow tuple.
 */
export function hashCanonicalFlow(flow: CanonicalFlowTuple): string {
  return `${flow.srcTupleA}:${flow.portA}-${flow.srcTupleB}:${flow.portB}-${flow.protocol}`;
}
