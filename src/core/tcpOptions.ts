export interface TcpOptions {
  mss?: number;
  sackPermitted?: boolean;
  windowScale?: number;
  timestamp?: { value: number; echoReply: number };
}

/** Encode common SYN options in the canonical Linux ordering, padded to 32 bits. */
export function encodeTcpOptions(options: TcpOptions): Uint8Array {
  const bytes: number[] = [];
  if (options.mss !== undefined) bytes.push(2, 4, options.mss >>> 8, options.mss & 0xff);
  if (options.sackPermitted) bytes.push(4, 2);
  if (options.timestamp) {
    bytes.push(8, 10);
    pushU32(bytes, options.timestamp.value);
    pushU32(bytes, options.timestamp.echoReply);
  }
  if (options.windowScale !== undefined) bytes.push(1, 3, 3, options.windowScale);
  while (bytes.length % 4 !== 0) bytes.push(0);
  return Uint8Array.from(bytes);
}

/** Parse supported options; returns null rather than discarding unknown wire data. */
export function decodeTcpOptions(bytes: Uint8Array): TcpOptions | null {
  const result: TcpOptions = {};
  for (let offset = 0; offset < bytes.length;) {
    const kind = bytes[offset]!;
    if (kind === 0) break;
    if (kind === 1) { offset++; continue; }
    const length = bytes[offset + 1];
    if (length === undefined || length < 2 || offset + length > bytes.length) return null;
    if (kind === 2 && length === 4) result.mss = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    else if (kind === 3 && length === 3) result.windowScale = bytes[offset + 2]!;
    else if (kind === 4 && length === 2) result.sackPermitted = true;
    else if (kind === 8 && length === 10) result.timestamp = { value: readU32(bytes, offset + 2), echoReply: readU32(bytes, offset + 6) };
    else return null;
    offset += length;
  }
  return result;
}

const pushU32 = (output: number[], value: number) => output.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
const readU32 = (bytes: Uint8Array, offset: number) => (((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0);
