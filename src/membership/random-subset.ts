import { createHash } from 'crypto';

export type SeedInput = string | number | bigint;

export interface CompositeSeedContext {
  roundNumber: SeedInput;
  nodeId: SeedInput;
  clusterEpoch: SeedInput;
}

function encodeSeedPart(value: SeedInput): Buffer {
  const text = typeof value === 'bigint' ? value.toString(10) : String(value);
  const data = Buffer.from(text, 'utf8');
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, data]);
}

export function deriveCompositeSeed(context: CompositeSeedContext): Buffer {
  return createHash('sha256')
    .update(encodeSeedPart(context.roundNumber))
    .update(encodeSeedPart(context.nodeId))
    .update(encodeSeedPart(context.clusterEpoch))
    .digest();
}

function seedWord(seed: Buffer, offset: number): number {
  return seed.readUInt32BE(offset % (seed.length - 3));
}

function createSeededRandom(seed: Buffer): () => number {
  let a = seedWord(seed, 0) || 0x9e3779b9;
  let b = seedWord(seed, 4) || 0x243f6a88;
  let c = seedWord(seed, 8) || 0xb7e15162;
  let d = seedWord(seed, 12) || 0xdeadbeef;

  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const result = (t + d) | 0;
    c = (c + result) | 0;
    return (result >>> 0) / 4294967296;
  };
}

export function deterministicShuffle<T>(items: readonly T[], context: CompositeSeedContext): T[] {
  const shuffled = [...items];
  const random = createSeededRandom(deriveCompositeSeed(context));

  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

export function randomSubset<T>(items: readonly T[], fanout: number, context: CompositeSeedContext): T[] {
  if (!Number.isInteger(fanout) || fanout < 0) {
    throw new Error('fanout must be a non-negative integer');
  }

  if (fanout >= items.length) return [...items];
  return deterministicShuffle(items, context).slice(0, fanout);
}
