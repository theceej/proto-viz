/** Checksum algorithms used by builtin protocols. */

/**
 * Internet checksum (RFC 1071): ones-complement of the ones-complement sum
 * of the data as 16-bit big-endian words. Odd trailing byte is padded with
 * a zero low byte.
 */
export function inet16(...chunks: Uint8Array[]): number {
  return inet16Calculation(...chunks).checksum;
}

export interface Inet16Calculation {
  /** Sum of all 16-bit words before end-around carry folding. */
  wordSum: number;
  /** 16-bit one's-complement sum after end-around carry folding. */
  foldedSum: number;
  /** One's complement of the folded sum. */
  checksum: number;
  wordCount: number;
}

/** Internet checksum plus the intermediate values used to explain it. */
export function inet16Calculation(...chunks: Uint8Array[]): Inet16Calculation {
  let sum = 0;
  let wordCount = 0;
  for (const data of chunks) {
    for (let i = 0; i + 1 < data.length; i += 2) {
      sum += (data[i]! << 8) | data[i + 1]!;
      wordCount++;
    }
    if (data.length % 2 === 1) {
      sum += data[data.length - 1]! << 8;
      wordCount++;
    }
  }
  const wordSum = sum;
  while (sum > 0xffff) sum = (sum & 0xffff) + Math.floor(sum / 0x10000);
  return {
    wordSum,
    foldedSum: sum,
    checksum: ~sum & 0xffff,
    wordCount,
  };
}

/** CRC-32C (Castagnoli), reflected, as used by SCTP (RFC 4960 appendix B). */
const CRC32C_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0x82f63b78 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32c(...chunks: Uint8Array[]): number {
  let crc = 0xffffffff;
  for (const data of chunks) {
    for (const byte of data) crc = CRC32C_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
