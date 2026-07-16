import type { FieldSpan } from './serialize';

/**
 * Byte-index → spans lookup for the hex view. A byte can contain several
 * fields (IPv4 version + IHL share byte 0); all are returned.
 */
export function buildSpanIndex(spans: FieldSpan[], totalBytes: number): FieldSpan[][] {
  const index: FieldSpan[][] = Array.from({ length: totalBytes }, () => []);
  for (const span of spans) {
    if (span.bitLength === 0) continue;
    const first = Math.floor(span.bitOffset / 8);
    const last = Math.floor((span.bitOffset + span.bitLength - 1) / 8);
    for (let b = first; b <= last && b < totalBytes; b++) index[b]!.push(span);
  }
  return index;
}
