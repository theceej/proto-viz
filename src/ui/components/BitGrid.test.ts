import { describe, expect, it } from 'vitest';
import type { FieldSpan, LayerLayout } from '../../core/serialize';
import { computeSegments } from './BitGrid';

const layout: LayerLayout = {
  uid: 'layer-1',
  protocolId: 'test',
  byteOffset: 0,
  headerBytes: 0,
};

function span(bitOffset: number, bitLength: number, fieldId = 'data'): FieldSpan {
  return {
    layerUid: 'layer-1',
    fieldId,
    bitOffset,
    bitLength,
    value: new Uint8Array(),
    computed: false,
    pinned: false,
  };
}

describe('computeSegments', () => {
  it('preserves field boundaries and widest-segment labels', () => {
    const result = computeSegments([span(4, 40)], layout);
    expect(result.rowCount).toBe(2);
    expect(result.segments).toEqual([
      expect.objectContaining({ row: 0, col: 4, width: 28, first: true }),
      expect.objectContaining({ row: 1, col: 0, width: 12, first: false }),
    ]);
  });

  it('collapses a maximum-sized field without expanding every wire row', () => {
    const result = computeSegments([span(0, 1 << 20)], layout);
    expect(result.rowCount).toBe(2);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toEqual(
      expect.objectContaining({ row: 1, width: 32, collapsed: '⋯ 131068 bytes' }),
    );
    expect(result.segments[1]).toEqual(
      expect.objectContaining({ row: 0, width: 32, first: true }),
    );
  });

  it('retains the expanded compatibility behavior for overlapping spans', () => {
    const result = computeSegments([span(0, 128, 'outer'), span(32, 32, 'inner')], layout);
    expect(result.rowCount).toBe(4);
    expect(result.segments.some((segment) => segment.span.fieldId === 'inner')).toBe(true);
    expect(result.segments.every((segment) => segment.collapsed === undefined)).toBe(true);
  });
});
