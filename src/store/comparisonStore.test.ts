import { beforeEach, describe, expect, it } from 'vitest';
import type { SerializedPacket } from '../core/serialize';
import { useComparisonStore } from './comparisonStore';

const packet = (byte: number): SerializedPacket => ({
  bytes: new Uint8Array([byte]),
  spans: [],
  layers: [],
  payloadOffset: 0,
  issues: [],
});

describe('comparisonStore', () => {
  beforeEach(() => useComparisonStore.getState().clear());

  it('keeps two packet snapshots and replaces the oldest selection', () => {
    const { addPacket } = useComparisonStore.getState();
    addPacket(packet(1), 'first');
    addPacket(packet(2), 'second');
    addPacket(packet(3), 'third');

    expect(useComparisonStore.getState().packets.map((item) => item.label)).toEqual([
      'second',
      'third',
    ]);
  });

  it('removes a selected packet', () => {
    const { addPacket } = useComparisonStore.getState();
    addPacket(packet(1), 'first');
    addPacket(packet(2), 'second');
    const firstId = useComparisonStore.getState().packets[0]!.id;

    useComparisonStore.getState().removePacket(firstId);

    expect(useComparisonStore.getState().packets).toHaveLength(1);
    expect(useComparisonStore.getState().packets[0]!.label).toBe('second');
  });
});
