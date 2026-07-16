import type { EnumTable, FieldDef, FieldValue } from '../core/model';
import { formatHexBytes, formatIPv4, formatIPv6, formatMac, valueToNumber } from '../core/values';

/** Human-readable rendering of a resolved field value. */
export function formatFieldValue(
  field: FieldDef,
  value: FieldValue,
  enumTable?: EnumTable,
): string {
  switch (field.type) {
    case 'uint': {
      const n = safeNumber(field, value);
      if (n === null) return String(value);
      const label = enumTable?.values[n];
      const hex = field.bitLength === 16 || n > 9999 ? ` (0x${n.toString(16)})` : '';
      return label ? `${n}${hex} — ${label}` : `${n}${hex}`;
    }
    case 'flags': {
      const n = safeNumber(field, value);
      if (n === null) return String(value);
      const width = typeof field.bitLength === 'number' ? field.bitLength : 8;
      const active = (field.flags ?? [])
        .filter((f) => n & (1 << (width - 1 - f.bit)))
        .map((f) => f.name);
      return active.length > 0 ? `${active.join(' ')} (0x${n.toString(16)})` : '0';
    }
    case 'bytes':
      return value instanceof Uint8Array
        ? value.length === 0
          ? '(empty)'
          : formatHexBytes(value)
        : String(value);
    case 'mac':
      return value instanceof Uint8Array ? formatMac(value) : String(value);
    case 'ipv4':
      return value instanceof Uint8Array ? formatIPv4(value) : String(value);
    case 'ipv6':
      return value instanceof Uint8Array ? formatIPv6(value) : String(value);
    case 'string':
    case 'dnsName':
      return String(value);
  }
}

/** Short value for tight spaces (bit-grid cells). */
export function formatFieldValueShort(field: FieldDef, value: FieldValue): string {
  switch (field.type) {
    case 'uint': {
      const n = safeNumber(field, value);
      if (n === null) return '';
      return typeof field.bitLength === 'number' && field.bitLength >= 16 && n > 255
        ? `0x${n.toString(16)}`
        : String(n);
    }
    case 'flags':
      return formatFieldValue(field, value).split(' (')[0] ?? '';
    case 'bytes':
      return value instanceof Uint8Array ? `${value.length} B` : '';
    default:
      return formatFieldValue(field, value);
  }
}

function safeNumber(field: FieldDef, value: FieldValue): number | null {
  try {
    return valueToNumber(field, value);
  } catch {
    return null;
  }
}

export function bitsLabel(bits: number): string {
  if (bits % 8 === 0) {
    const bytes = bits / 8;
    return bytes === 1 ? '1 byte' : `${bytes} bytes`;
  }
  return bits === 1 ? '1 bit' : `${bits} bits`;
}
