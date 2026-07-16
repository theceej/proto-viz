import { describe, expect, it } from 'vitest';
import { crc32c, inet16 } from './checksums';

describe('inet16', () => {
  it('matches the RFC 1071 worked example', () => {
    // Words 0001 f203 f4f5 f6f7 -> sum ddf2 -> checksum 220d
    const data = Uint8Array.from([0x00, 0x01, 0xf2, 0x03, 0xf4, 0xf5, 0xf6, 0xf7]);
    expect(inet16(data)).toBe(0x220d);
  });

  it('pads an odd trailing byte with zero', () => {
    expect(inet16(Uint8Array.from([0x01]))).toBe(inet16(Uint8Array.from([0x01, 0x00])));
  });

  it('sums across multiple chunks like one buffer', () => {
    const whole = Uint8Array.from([0x12, 0x34, 0x56, 0x78]);
    expect(inet16(whole.slice(0, 2), whole.slice(2))).toBe(inet16(whole));
  });

  it('verifies to zero over data with checksum in place', () => {
    const data = Uint8Array.from([0x45, 0x00, 0x00, 0x1c, 0x12, 0x34, 0x00, 0x00]);
    const ck = inet16(data);
    const withCk = Uint8Array.from([...data, ck >> 8, ck & 0xff]);
    expect(inet16(withCk)).toBe(0);
  });
});

describe('crc32c', () => {
  it('matches the standard check value', () => {
    expect(crc32c(new TextEncoder().encode('123456789'))).toBe(0xe3069283);
  });
});
