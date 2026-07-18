import { describe, expect, it } from 'vitest';
import type { FieldDef } from '../../../core/model';
import { toEditString, tryParse } from './fieldValueText';

const field = (over: Partial<FieldDef> & Pick<FieldDef, 'type'>): FieldDef => ({
  id: 'f',
  name: 'F',
  bitLength: 8,
  ...over,
});

describe('toEditString', () => {
  it('renders undefined as an empty string', () => {
    expect(toEditString(field({ type: 'uint' }), undefined)).toBe('');
  });

  it('renders small numbers in decimal', () => {
    expect(toEditString(field({ type: 'uint', bitLength: 8 }), 42)).toBe('42');
  });

  it('renders wide numbers above 9999 in hex, narrow ones in decimal', () => {
    expect(toEditString(field({ type: 'uint', bitLength: 16 }), 0x2710)).toBe('0x2710');
    expect(toEditString(field({ type: 'uint', bitLength: 16 }), 9999)).toBe('9999');
    // An 8-bit field never crosses the >9999 threshold, so it stays decimal.
    expect(toEditString(field({ type: 'uint', bitLength: 8 }), 200)).toBe('200');
  });

  it('renders a bytes value as space-separated hex octets', () => {
    expect(toEditString(field({ type: 'bytes', bitLength: 'auto' }), new Uint8Array([0xde, 0x00, 0xef]))).toBe(
      'de 00 ef',
    );
  });

  it('renders string-ish values as-is', () => {
    expect(toEditString(field({ type: 'ipv4' }), '192.0.2.1')).toBe('192.0.2.1');
  });
});

describe('tryParse uint', () => {
  const u16 = field({ type: 'uint', bitLength: 16 });

  it('accepts decimal and hex within range', () => {
    expect(tryParse(u16, '1000')).toEqual({ value: 1000 });
    expect(tryParse(u16, '0x1f4')).toEqual({ value: 500 });
  });

  it('rejects values past the bit-width maximum', () => {
    expect(tryParse(field({ type: 'uint', bitLength: 8 }), '256')).toBeNull();
    expect(tryParse(field({ type: 'uint', bitLength: 8 }), '255')).toEqual({ value: 255 });
  });

  it('rejects negatives and non-numeric text', () => {
    expect(tryParse(u16, '-1')).toBeNull();
    expect(tryParse(u16, 'ff')).toBeNull();
    expect(tryParse(u16, '')).toBeNull();
  });
});

describe('tryParse addresses and bytes', () => {
  it('validates MAC / IPv4 / IPv6 and rejects malformed input', () => {
    expect(tryParse(field({ type: 'mac' }), '02:00:00:00:00:01')).toEqual({
      value: '02:00:00:00:00:01',
    });
    expect(tryParse(field({ type: 'mac' }), 'nope')).toBeNull();
    expect(tryParse(field({ type: 'ipv4' }), '192.0.2.1')).toEqual({ value: '192.0.2.1' });
    expect(tryParse(field({ type: 'ipv4' }), '999.0.0.1')).toBeNull();
    expect(tryParse(field({ type: 'ipv6' }), '2001:db8::1')).toEqual({ value: '2001:db8::1' });
    expect(tryParse(field({ type: 'ipv6' }), 'xyz')).toBeNull();
  });

  it('parses hex bytes', () => {
    const parsed = tryParse(field({ type: 'bytes', bitLength: 'auto' }), 'de ad be ef');
    expect(parsed?.value).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('passes string and dnsName through verbatim, preserving surrounding spaces', () => {
    expect(tryParse(field({ type: 'string' }), ' hi ')).toEqual({ value: ' hi ' });
    expect(tryParse(field({ type: 'dnsName' }), 'example.com')).toEqual({ value: 'example.com' });
  });
});
