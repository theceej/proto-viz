/**
 * Bit-level buffer access, MSB-first (network bit order).
 * Bit offset 0 is the most significant bit of byte 0.
 */

export class BitIoError extends Error {}

/** Write an unsigned value of `nBits` (1..64) at an arbitrary bit offset. */
export function setBits(
  buf: Uint8Array,
  bitOffset: number,
  nBits: number,
  value: number | bigint,
): void {
  if (nBits < 1 || nBits > 64) throw new BitIoError(`unsupported bit width ${nBits}`);
  let v = BigInt(value);
  const max = (1n << BigInt(nBits)) - 1n;
  if (v < 0n) throw new BitIoError(`negative value ${v}`);
  v &= max; // truncate overflowing high bits rather than corrupting neighbours
  for (let i = nBits - 1; i >= 0; i--) {
    const bit = Number(v & 1n);
    v >>= 1n;
    const pos = bitOffset + i;
    const byte = pos >> 3;
    const shift = 7 - (pos & 7);
    if (byte >= buf.length) throw new BitIoError('write past end of buffer');
    if (bit) buf[byte]! |= 1 << shift;
    else buf[byte]! &= ~(1 << shift);
  }
}

/** Read an unsigned value of `nBits` (1..64) from an arbitrary bit offset. */
export function getBits(buf: Uint8Array, bitOffset: number, nBits: number): bigint {
  if (nBits < 1 || nBits > 64) throw new BitIoError(`unsupported bit width ${nBits}`);
  let v = 0n;
  for (let i = 0; i < nBits; i++) {
    const pos = bitOffset + i;
    const byte = pos >> 3;
    const shift = 7 - (pos & 7);
    if (byte >= buf.length) throw new BitIoError('read past end of buffer');
    v = (v << 1n) | BigInt((buf[byte]! >> shift) & 1);
  }
  return v;
}

/** Copy bytes into the buffer at a byte-aligned bit offset. */
export function setBytes(buf: Uint8Array, bitOffset: number, bytes: Uint8Array): void {
  if (bitOffset % 8 !== 0) throw new BitIoError('byte field is not byte-aligned');
  const start = bitOffset / 8;
  if (start + bytes.length > buf.length) throw new BitIoError('write past end of buffer');
  buf.set(bytes, start);
}

export function getBytes(buf: Uint8Array, bitOffset: number, nBits: number): Uint8Array {
  if (bitOffset % 8 !== 0 || nBits % 8 !== 0)
    throw new BitIoError('byte field is not byte-aligned');
  const start = bitOffset / 8;
  return buf.slice(start, start + nBits / 8);
}
