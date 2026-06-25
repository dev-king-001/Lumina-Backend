import { createHash } from 'crypto';

export function deriveNodeId(input: string): bigint {
  const digest = createHash('sha256').update(input, 'utf8').digest();
  return digest.readBigUInt64BE(0);
}
