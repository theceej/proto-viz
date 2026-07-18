import type { FieldDef, FieldValue } from '../../../core/model';
import {
  parseHexBytes,
  parseIPv4,
  parseIPv6,
  parseMac,
} from '../../../core/values';
import { formatFieldValue } from '../../format';

/**
 * The text <-> value bridge for the single-line field editors: how a field's
 * committed value is rendered into an editable string, and how typed text is
 * validated and parsed back. Pure and framework-free so it can be unit-tested
 * directly; the input components own only the draft/invalid UI state.
 */

/** Render a field value as the string shown in its editor input. */
export function toEditString(field: FieldDef, value: FieldValue | undefined): string {
  if (value === undefined) return '';
  if (value instanceof Uint8Array) {
    if (field.type === 'bytes')
      return [...value].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    return formatFieldValue(field, value);
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    const n = Number(value);
    return typeof field.bitLength === 'number' && field.bitLength >= 16 && n > 9999
      ? `0x${n.toString(16)}`
      : String(n);
  }
  return String(value);
}

/** Parse editor text for a field, or null if it isn't valid for the type. */
export function tryParse(field: FieldDef, text: string): { value: FieldValue } | null {
  const t = text.trim();
  try {
    switch (field.type) {
      case 'uint': {
        if (!/^(0x[0-9a-fA-F]+|\d+)$/.test(t)) return null;
        const n = Number(t);
        const max = typeof field.bitLength === 'number' ? 2 ** field.bitLength - 1 : Infinity;
        if (!Number.isSafeInteger(n) || n < 0 || n > max) return null;
        return { value: n };
      }
      case 'mac':
        parseMac(t);
        return { value: t };
      case 'ipv4':
        parseIPv4(t);
        return { value: t };
      case 'ipv6':
        parseIPv6(t);
        return { value: t };
      case 'bytes':
        return { value: parseHexBytes(t) };
      case 'string':
      case 'dnsName':
        return { value: text };
      default:
        return null;
    }
  } catch {
    return null;
  }
}
