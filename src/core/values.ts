/**
 * Conversion between user-facing field values (strings for addresses, numbers
 * for uints) and their wire representation.
 */
import type { FieldDef, FieldValue } from './model';

export class ValueError extends Error {}

export function parseMac(s: string): Uint8Array {
  const parts = s.trim().split(/[:-]/);
  if (parts.length !== 6 || parts.some((p) => !/^[0-9a-fA-F]{1,2}$/.test(p)))
    throw new ValueError(`invalid MAC address "${s}"`);
  return Uint8Array.from(parts.map((p) => parseInt(p, 16)));
}

export function formatMac(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join(':');
}

export function parseIPv4(s: string): Uint8Array {
  const parts = s.trim().split('.');
  if (parts.length !== 4) throw new ValueError(`invalid IPv4 address "${s}"`);
  const nums = parts.map((p) => {
    if (!/^\d{1,3}$/.test(p)) throw new ValueError(`invalid IPv4 address "${s}"`);
    const n = Number(p);
    if (n > 255) throw new ValueError(`invalid IPv4 address "${s}"`);
    return n;
  });
  return Uint8Array.from(nums);
}

export function formatIPv4(b: Uint8Array): string {
  return [...b].join('.');
}

export function parseIPv6(s: string): Uint8Array {
  const str = s.trim();
  if (!str.includes(':')) throw new ValueError(`invalid IPv6 address "${s}"`);
  const halves = str.split('::');
  if (halves.length > 2) throw new ValueError(`invalid IPv6 address "${s}"`);

  const parseGroups = (part: string): number[] => {
    if (part === '') return [];
    return part.split(':').map((g) => {
      // Embedded IPv4 tail, e.g. ::ffff:192.0.2.1
      if (g.includes('.')) {
        const v4 = parseIPv4(g);
        // caller flattens; return marker handled below
        return -1 - ((v4[0]! << 24) | (v4[1]! << 16) | (v4[2]! << 8) | v4[3]!);
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) throw new ValueError(`invalid IPv6 address "${s}"`);
      return parseInt(g, 16);
    });
  };

  const expand = (groups: number[]): number[] => {
    const out: number[] = [];
    for (const g of groups) {
      if (g < 0) {
        const v4 = -1 - g;
        out.push((v4 >>> 16) & 0xffff, v4 & 0xffff);
      } else out.push(g);
    }
    return out;
  };

  const head = expand(parseGroups(halves[0]!));
  const tail = halves.length === 2 ? expand(parseGroups(halves[1]!)) : [];
  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) throw new ValueError(`invalid IPv6 address "${s}"`);
    groups = [...head, ...Array(fill).fill(0), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) throw new ValueError(`invalid IPv6 address "${s}"`);
  const out = new Uint8Array(16);
  groups.forEach((g, i) => {
    out[i * 2] = g >> 8;
    out[i * 2 + 1] = g & 0xff;
  });
  return out;
}

export function formatIPv6(b: Uint8Array): string {
  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2) groups.push((b[i]! << 8) | b[i + 1]!);
  // Find longest run of zero groups (length >= 2) for :: compression.
  let best = { start: -1, len: 0 };
  let cur = { start: -1, len: 0 };
  groups.forEach((g, i) => {
    if (g === 0) {
      if (cur.start === -1) cur = { start: i, len: 0 };
      cur.len++;
      if (cur.len > best.len) best = { ...cur };
    } else cur = { start: -1, len: 0 };
  });
  if (best.len >= 2) {
    const head = groups.slice(0, best.start).map((g) => g.toString(16));
    const tail = groups.slice(best.start + best.len).map((g) => g.toString(16));
    return `${head.join(':')}::${tail.join(':')}`;
  }
  return groups.map((g) => g.toString(16)).join(':');
}

/** Encode a domain name as DNS labels (no compression). */
export function encodeDnsName(name: string): Uint8Array {
  const trimmed = name.trim().replace(/\.$/, '');
  const labels = trimmed === '' ? [] : trimmed.split('.');
  const parts: number[] = [];
  for (const label of labels) {
    const bytes = new TextEncoder().encode(label);
    if (bytes.length === 0 || bytes.length > 63)
      throw new ValueError(`invalid DNS label "${label}"`);
    parts.push(bytes.length, ...bytes);
  }
  parts.push(0);
  return Uint8Array.from(parts);
}

export function decodeDnsName(b: Uint8Array): string {
  const labels: string[] = [];
  let i = 0;
  while (i < b.length) {
    const len = b[i]!;
    if (len === 0) break;
    labels.push(new TextDecoder().decode(b.slice(i + 1, i + 1 + len)));
    i += 1 + len;
  }
  return labels.join('.');
}

export function parseHexBytes(s: string): Uint8Array {
  const clean = s.replace(/[\s:,]/g, '');
  if (clean === '') return new Uint8Array(0);
  if (!/^([0-9a-fA-F]{2})+$/.test(clean)) throw new ValueError(`invalid hex "${s}"`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function formatHexBytes(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');
}

/**
 * Convert a field value to its wire bytes (for byte-oriented field types).
 * Returns null for uint/flags fields (those go through setBits instead).
 */
export function valueToBytes(field: FieldDef, value: FieldValue): Uint8Array | null {
  switch (field.type) {
    case 'uint':
    case 'flags':
      return null;
    case 'bytes':
      if (value instanceof Uint8Array) return value;
      if (typeof value === 'string') return parseHexBytes(value);
      throw new ValueError(`field ${field.id}: expected bytes`);
    case 'mac':
      if (typeof value === 'string') return parseMac(value);
      if (value instanceof Uint8Array) return value;
      throw new ValueError(`field ${field.id}: expected MAC string`);
    case 'ipv4':
      if (typeof value === 'string') return parseIPv4(value);
      if (value instanceof Uint8Array) return value;
      throw new ValueError(`field ${field.id}: expected IPv4 string`);
    case 'ipv6':
      if (typeof value === 'string') return parseIPv6(value);
      if (value instanceof Uint8Array) return value;
      throw new ValueError(`field ${field.id}: expected IPv6 string`);
    case 'string':
      if (typeof value === 'string') return new TextEncoder().encode(value);
      if (value instanceof Uint8Array) return value;
      throw new ValueError(`field ${field.id}: expected string`);
    case 'dnsName':
      if (typeof value === 'string') return encodeDnsName(value);
      if (value instanceof Uint8Array) return value;
      throw new ValueError(`field ${field.id}: expected domain name`);
  }
}

/** Numeric value of a uint/flags field (used by expressions and bindings). */
export function valueToNumber(field: FieldDef, value: FieldValue): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && /^(0x[0-9a-fA-F]+|\d+)$/.test(value.trim()))
    return Number(value.trim());
  throw new ValueError(`field ${field.id}: expected a number, got ${String(value)}`);
}

/** Default zero value for a field type. */
export function zeroValue(field: FieldDef): FieldValue {
  switch (field.type) {
    case 'uint':
    case 'flags':
      return 0;
    case 'bytes':
      return new Uint8Array(0);
    case 'mac':
      return '00:00:00:00:00:00';
    case 'ipv4':
      return '0.0.0.0';
    case 'ipv6':
      return '::';
    case 'string':
      return '';
    case 'dnsName':
      return '';
  }
}
