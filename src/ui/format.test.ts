import { describe, expect, it } from 'vitest';
import { bitsLabel, formatFieldValue, formatFieldValueShort } from './format';
import type { EnumTable, FieldDef } from '../core/model';

const uint16: FieldDef = { id: 'f', name: 'F', type: 'uint', bitLength: 16 };
const tcpFlags: FieldDef = {
  id: 'flags',
  name: 'Flags',
  type: 'flags',
  bitLength: 8,
  flags: [
    { bit: 0, name: 'CWR' },
    { bit: 1, name: 'ECE' },
    { bit: 2, name: 'URG' },
    { bit: 3, name: 'ACK' },
    { bit: 4, name: 'PSH' },
    { bit: 5, name: 'RST' },
    { bit: 6, name: 'SYN' },
    { bit: 7, name: 'FIN' },
  ],
};
const enumTable: EnumTable = { id: 'e', name: 'E', values: { 80: 'HTTP' } };
const mac: FieldDef = { id: 'm', name: 'M', type: 'mac', bitLength: 48 };
const ipv4: FieldDef = { id: '4', name: 'IPv4', type: 'ipv4', bitLength: 32 };
const ipv6: FieldDef = { id: '6', name: 'IPv6', type: 'ipv6', bitLength: 128 };
const text: FieldDef = { id: 's', name: 'S', type: 'string', bitLength: 'auto' };
const dnsName: FieldDef = { id: 'd', name: 'D', type: 'dnsName', bitLength: 'auto' };

describe('formatFieldValue', () => {
  it('labels enum values', () => {
    expect(formatFieldValue(uint16, 80, enumTable)).toContain('HTTP');
    expect(formatFieldValue(uint16, 81, enumTable)).not.toContain('HTTP');
  });

  it('shows hex alongside 16-bit values', () => {
    expect(formatFieldValue(uint16, 0x0800)).toContain('0x800');
  });

  it('names active flag bits MSB-first', () => {
    expect(formatFieldValue(tcpFlags, 0x12)).toBe('ACK SYN (0x12)');
    expect(formatFieldValue(tcpFlags, 0)).toBe('0');
    // Non-numeric bitLength falls back to an 8-bit width.
    expect(formatFieldValue({ ...tcpFlags, bitLength: 'auto' }, 0x12)).toBe('ACK SYN (0x12)');
  });

  it('renders byte values as hex or (empty)', () => {
    const bytes: FieldDef = { ...uint16, type: 'bytes' };
    expect(formatFieldValue(bytes, Uint8Array.from([0xde, 0xad]))).toBe('de ad');
    expect(formatFieldValue(bytes, new Uint8Array(0))).toBe('(empty)');
  });

  it('shows hex for wide non-16-bit values above 9999', () => {
    expect(formatFieldValue({ ...uint16, bitLength: 32 }, 100000)).toBe('100000 (0x186a0)');
  });

  it('formats MAC / IPv4 / IPv6 from wire bytes', () => {
    expect(formatFieldValue(mac, Uint8Array.from([2, 0, 0, 0, 0, 1]))).toBe('02:00:00:00:00:01');
    expect(formatFieldValue(ipv4, Uint8Array.from([192, 0, 2, 1]))).toBe('192.0.2.1');
    expect(formatFieldValue(ipv6, new Uint8Array(16))).toBe('::');
  });

  it('passes through already-formatted address strings and text fields', () => {
    expect(formatFieldValue(mac, '02:00:00:00:00:01')).toBe('02:00:00:00:00:01');
    expect(formatFieldValue(ipv4, '198.51.100.7')).toBe('198.51.100.7');
    expect(formatFieldValue(ipv6, '2001:db8::1')).toBe('2001:db8::1');
    expect(formatFieldValue(text, 'hello')).toBe('hello');
    expect(formatFieldValue(dnsName, 'example.com')).toBe('example.com');
  });

  it('is robust to malformed values', () => {
    expect(formatFieldValue(uint16, 'garbage')).toBe('garbage');
    expect(formatFieldValue(tcpFlags, 'garbage')).toBe('garbage');
    // A bytes field holding a non-Uint8Array falls back to String().
    expect(formatFieldValue({ ...uint16, type: 'bytes' }, 'raw' as unknown as Uint8Array)).toBe('raw');
  });
});

describe('formatFieldValueShort', () => {
  it('compacts wide values to hex and byte fields to a size', () => {
    expect(formatFieldValueShort(uint16, 0x8100)).toBe('0x8100');
    expect(formatFieldValueShort(uint16, 80)).toBe('80');
    expect(formatFieldValueShort({ ...uint16, type: 'bytes' }, new Uint8Array(6))).toBe('6 B');
  });

  it('drops the hex suffix from flags and returns empty for unusable values', () => {
    expect(formatFieldValueShort(tcpFlags, 0x12)).toBe('ACK SYN');
    expect(formatFieldValueShort(uint16, 'garbage')).toBe('');
    expect(formatFieldValueShort({ ...uint16, type: 'bytes' }, 'x' as unknown as Uint8Array)).toBe('');
  });

  it('falls back to the full format for address and text fields', () => {
    expect(formatFieldValueShort(mac, Uint8Array.from([2, 0, 0, 0, 0, 1]))).toBe('02:00:00:00:00:01');
    expect(formatFieldValueShort(text, 'hi')).toBe('hi');
  });
});

describe('bitsLabel', () => {
  it('prefers bytes when byte-aligned', () => {
    expect(bitsLabel(8)).toBe('1 byte');
    expect(bitsLabel(32)).toBe('4 bytes');
    expect(bitsLabel(13)).toBe('13 bits');
    expect(bitsLabel(1)).toBe('1 bit');
  });
});
