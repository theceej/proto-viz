import { describe, expect, it } from 'vitest';
import {
  decodeDnsName,
  encodeDnsName,
  formatHexBytes,
  parseHexBytes,
  parseIPv6,
  valueToNumber,
  zeroValue,
  ValueError,
} from './values';
import type { FieldDef } from './model';

const uintField: FieldDef = { id: 'f', name: 'F', type: 'uint', bitLength: 16 };

describe('parseHexBytes', () => {
  it('accepts spaces, colons, and commas as separators', () => {
    expect([...parseHexBytes('de ad:be,ef')]).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect([...parseHexBytes('DEADBEEF')]).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it('returns empty for empty input and rejects odd/invalid hex', () => {
    expect(parseHexBytes('').length).toBe(0);
    expect(() => parseHexBytes('abc')).toThrow(ValueError);
    expect(() => parseHexBytes('zz')).toThrow(ValueError);
  });

  it('round-trips with formatHexBytes', () => {
    const b = Uint8Array.from([0, 15, 255]);
    expect([...parseHexBytes(formatHexBytes(b))]).toEqual([...b]);
  });
});

describe('IPv6 edge cases', () => {
  it('parses the embedded-IPv4 form', () => {
    const b = parseIPv6('::ffff:192.0.2.1');
    expect(b[10]).toBe(0xff);
    expect(b[11]).toBe(0xff);
    expect([...b.slice(12)]).toEqual([192, 0, 2, 1]);
  });

  it('rejects double compression and garbage', () => {
    expect(() => parseIPv6('1::2::3')).toThrow(ValueError);
    expect(() => parseIPv6('hello')).toThrow(ValueError);
    expect(() => parseIPv6('1:2:3')).toThrow(ValueError);
  });
});

describe('DNS names', () => {
  it('round-trips multi-label names', () => {
    expect(decodeDnsName(encodeDnsName('a.b.example.co.uk'))).toBe('a.b.example.co.uk');
  });

  it('ignores a trailing dot and rejects oversized labels', () => {
    expect([...encodeDnsName('example.com.')]).toEqual([...encodeDnsName('example.com')]);
    expect(() => encodeDnsName('x'.repeat(64) + '.com')).toThrow(ValueError);
  });
});

describe('valueToNumber', () => {
  it('accepts numbers, bigints, and numeric strings', () => {
    expect(valueToNumber(uintField, 42)).toBe(42);
    expect(valueToNumber(uintField, 42n)).toBe(42);
    expect(valueToNumber(uintField, '42')).toBe(42);
    expect(valueToNumber(uintField, '0x2a')).toBe(42);
  });

  it('rejects non-numeric strings', () => {
    expect(() => valueToNumber(uintField, 'forty-two')).toThrow(ValueError);
  });
});

describe('zeroValue', () => {
  it('provides a sensible zero per type', () => {
    expect(zeroValue({ ...uintField, type: 'uint' })).toBe(0);
    expect(zeroValue({ ...uintField, type: 'mac' })).toBe('00:00:00:00:00:00');
    expect(zeroValue({ ...uintField, type: 'ipv4' })).toBe('0.0.0.0');
    expect(zeroValue({ ...uintField, type: 'ipv6' })).toBe('::');
    expect(zeroValue({ ...uintField, type: 'bytes' })).toBeInstanceOf(Uint8Array);
    expect(zeroValue({ ...uintField, type: 'string' })).toBe('');
  });
});
