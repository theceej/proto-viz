export interface Ipv4Options {
  routerAlert?: number;
  recordRoute?: string[];
  timestamps?: number[];
  looseSourceRoute?: string[];
  strictSourceRoute?: string[];
}

const MAX_OPTIONS_BYTES = 40;

/** Encode common RFC 791/2113 options and pad the header to a 32-bit boundary. */
export function encodeIpv4Options(options: Ipv4Options): Uint8Array {
  const bytes: number[] = [];
  if (options.routerAlert !== undefined) bytes.push(148, 4, options.routerAlert >>> 8, options.routerAlert & 0xff);
  pushRoute(bytes, 7, options.recordRoute);
  if (options.timestamps) {
    bytes.push(68, 4 + options.timestamps.length * 4, 5, 0);
    for (const timestamp of options.timestamps) pushU32(bytes, timestamp);
  }
  pushRoute(bytes, 131, options.looseSourceRoute);
  pushRoute(bytes, 137, options.strictSourceRoute);
  if (bytes.length > MAX_OPTIONS_BYTES) throw new Error('IPv4 options cannot exceed 40 bytes');
  while (bytes.length % 4 !== 0) bytes.push(0);
  if (bytes.length > MAX_OPTIONS_BYTES) throw new Error('IPv4 options cannot exceed 40 bytes');
  return Uint8Array.from(bytes);
}

/** Parse supported options; unknown or malformed data stays available as raw hex. */
export function decodeIpv4Options(bytes: Uint8Array): Ipv4Options | null {
  const result: Ipv4Options = {};
  for (let offset = 0; offset < bytes.length;) {
    const kind = bytes[offset]!;
    if (kind === 0) break;
    if (kind === 1) { offset++; continue; }
    const length = bytes[offset + 1];
    if (length === undefined || length < 2 || offset + length > bytes.length) return null;
    if (kind === 148 && length === 4) result.routerAlert = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    else if ([7, 131, 137].includes(kind) && length >= 3 && (length - 3) % 4 === 0) {
      const routes: string[] = [];
      for (let cursor = offset + 3; cursor < offset + length; cursor += 4) routes.push(readAddress(bytes, cursor));
      if (kind === 7) result.recordRoute = routes;
      else if (kind === 131) result.looseSourceRoute = routes;
      else result.strictSourceRoute = routes;
    } else if (kind === 68 && length >= 4 && (length - 4) % 4 === 0 && bytes[offset + 3] === 0) {
      result.timestamps = [];
      for (let cursor = offset + 4; cursor < offset + length; cursor += 4) result.timestamps.push(readU32(bytes, cursor));
    } else return null;
    offset += length;
  }
  return result;
}

const pushRoute = (output: number[], kind: number, routes?: string[]) => {
  if (!routes) return;
  output.push(kind, 3 + routes.length * 4, 4);
  for (const route of routes) output.push(...parseAddress(route));
};
const parseAddress = (address: string) => {
  const octets = address.trim().split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) throw new Error(`invalid IPv4 option address "${address}"`);
  return octets;
};
const readAddress = (bytes: Uint8Array, offset: number) => [0, 1, 2, 3].map((index) => bytes[offset + index]).join('.');
const pushU32 = (output: number[], value: number) => output.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
const readU32 = (bytes: Uint8Array, offset: number) => (((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0);
