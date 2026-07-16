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
  });

  it('renders byte values as hex or (empty)', () => {
    const bytes: FieldDef = { ...uint16, type: 'bytes' };
    expect(formatFieldValue(bytes, Uint8Array.from([0xde, 0xad]))).toBe('de ad');
    expect(formatFieldValue(bytes, new Uint8Array(0))).toBe('(empty)');
  });

  it('is robust to malformed values', () => {
    expect(formatFieldValue(uint16, 'garbage')).toBe('garbage');
  });
});

describe('formatFieldValueShort', () => {
  it('compacts wide values to hex and byte fields to a size', () => {
    expect(formatFieldValueShort(uint16, 0x8100)).toBe('0x8100');
    expect(formatFieldValueShort(uint16, 80)).toBe('80');
    expect(formatFieldValueShort({ ...uint16, type: 'bytes' }, new Uint8Array(6))).toBe('6 B');
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
