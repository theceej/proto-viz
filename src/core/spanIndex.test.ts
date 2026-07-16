import { describe, expect, it } from 'vitest';
import { buildSpanIndex } from './spanIndex';
import type { FieldSpan } from './serialize';

const span = (fieldId: string, bitOffset: number, bitLength: number): FieldSpan => ({
  layerUid: 'L1',
  fieldId,
  bitOffset,
  bitLength,
  value: 0,
  computed: false,
  pinned: false,
});

describe('buildSpanIndex', () => {
  it('maps sub-byte fields sharing one byte (IPv4 version + IHL)', () => {
    const index = buildSpanIndex([span('version', 0, 4), span('ihl', 4, 4)], 2);
    expect(index[0]!.map((s) => s.fieldId)).toEqual(['version', 'ihl']);
    expect(index[1]).toEqual([]);
  });

  it('maps multi-byte fields to every byte they touch', () => {
    const index = buildSpanIndex([span('mac', 8, 48)], 8);
    expect(index[0]).toEqual([]);
    for (let b = 1; b <= 6; b++) expect(index[b]!.map((s) => s.fieldId)).toEqual(['mac']);
    expect(index[7]).toEqual([]);
  });

  it('handles fields ending mid-byte (13-bit fragment offset)', () => {
    const index = buildSpanIndex([span('flags', 0, 3), span('frag', 3, 13)], 2);
    expect(index[0]!.map((s) => s.fieldId)).toEqual(['flags', 'frag']);
    expect(index[1]!.map((s) => s.fieldId)).toEqual(['frag']);
  });

  it('skips zero-length spans and clamps to buffer size', () => {
    const index = buildSpanIndex([span('empty', 0, 0), span('long', 8, 64)], 2);
    expect(index[0]).toEqual([]);
    expect(index[1]!.map((s) => s.fieldId)).toEqual(['long']);
  });
});
