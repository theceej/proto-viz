import { describe, expect, it } from 'vitest';
import { getBits, setBits, setBytes } from './bitio';

describe('bitio', () => {
  it('writes MSB-first within a byte', () => {
    const buf = new Uint8Array(2);
    setBits(buf, 0, 4, 0xf);
    expect(buf[0]).toBe(0xf0);
    setBits(buf, 4, 4, 0x5);
    expect(buf[0]).toBe(0xf5);
  });

  it('round-trips values crossing byte boundaries', () => {
    const buf = new Uint8Array(4);
    setBits(buf, 3, 13, 0x1abc & 0x1fff);
    expect(Number(getBits(buf, 3, 13))).toBe(0x1abc & 0x1fff);
    // Neighbouring bits untouched
    expect(Number(getBits(buf, 0, 3))).toBe(0);
    expect(Number(getBits(buf, 16, 8))).toBe(0);
  });

  it('handles 48-bit values (MAC addresses)', () => {
    const buf = new Uint8Array(8);
    setBits(buf, 8, 48, 0x020000000001n);
    expect(getBits(buf, 8, 48)).toBe(0x020000000001n);
    expect(buf[1]).toBe(0x02);
    expect(buf[6]).toBe(0x01);
  });

  it('overwrites previous bits cleanly', () => {
    const buf = new Uint8Array(2);
    setBits(buf, 4, 8, 0xff);
    setBits(buf, 4, 8, 0x00);
    expect(buf[0]).toBe(0);
    expect(buf[1]).toBe(0);
  });

  it('setBytes requires byte alignment', () => {
    const buf = new Uint8Array(4);
    expect(() => setBytes(buf, 4, new Uint8Array([1]))).toThrow();
    setBytes(buf, 8, new Uint8Array([0xaa, 0xbb]));
    expect([...buf]).toEqual([0, 0xaa, 0xbb, 0]);
  });
});
