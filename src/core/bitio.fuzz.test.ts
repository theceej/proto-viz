import { describe, expect, it } from 'vitest';
import { getBits, setBits } from './bitio';

/** Deterministic PRNG so failures are reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('bitio property tests', () => {
  it('setBits/getBits round-trip at random offsets and widths', () => {
    const rand = mulberry32(0xc0ffee);
    for (let i = 0; i < 2000; i++) {
      const buf = new Uint8Array(16);
      const nBits = 1 + Math.floor(rand() * 64);
      const bitOffset = Math.floor(rand() * (16 * 8 - nBits));
      const max = (1n << BigInt(nBits)) - 1n;
      const value = BigInt(Math.floor(rand() * Number.MAX_SAFE_INTEGER)) & max;
      setBits(buf, bitOffset, nBits, value);
      expect(getBits(buf, bitOffset, nBits)).toBe(value);
    }
  });

  it('writes never disturb neighbouring bits', () => {
    const rand = mulberry32(0xdecafbad);
    for (let i = 0; i < 500; i++) {
      const buf = new Uint8Array(8).fill(0xff);
      const nBits = 1 + Math.floor(rand() * 32);
      const bitOffset = Math.floor(rand() * (64 - nBits));
      setBits(buf, bitOffset, nBits, 0);
      // everything outside [bitOffset, bitOffset+nBits) must still be 1
      for (let b = 0; b < 64; b++) {
        const expected = b >= bitOffset && b < bitOffset + nBits ? 0n : 1n;
        expect(getBits(buf, b, 1)).toBe(expected);
      }
    }
  });
});
