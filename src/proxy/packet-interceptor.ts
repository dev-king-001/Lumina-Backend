import { BandwidthCalculator } from '../metering/bandwidth-calculator';
import { FlowTuple } from '../metering/flow-normalizer';

/**
 * Intercepts packets and forwards their bandwidth metadata to the metering pipeline.
 */
export function interceptPacket(nicId: number, srcIp: string, dstIp: string, srcPort: number, dstPort: number, protocol: string, byteLength: number) {
    const flow: FlowTuple = {
        srcIp,
        dstIp,
        srcPort,
        dstPort,
        protocol
    };
    
    BandwidthCalculator.dispatchCounterUpdate(nicId, flow, BigInt(byteLength));
}
