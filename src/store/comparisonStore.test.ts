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

  it('replaces snapshots with fresh IDs and keeps only the latest two', () => {
    useComparisonStore.getState().addPacket(packet(0), 'old');
    const oldId = useComparisonStore.getState().packets[0]!.id;

    useComparisonStore.getState().replacePackets([
      { label: 'first', packet: packet(1) },
      { label: 'second', packet: packet(2) },
      { label: 'third', packet: packet(3) },
    ]);

    const restored = useComparisonStore.getState().packets;
    expect(restored.map(({ label }) => label)).toEqual(['second', 'third']);
    expect(restored.every(({ id }) => id !== oldId)).toBe(true);
    expect(new Set(restored.map(({ id }) => id)).size).toBe(2);
  });

  it('merges existing then incoming snapshots and deterministically keeps the latest two', () => {
    const { addPacket, mergePackets } = useComparisonStore.getState();
    addPacket(packet(1), 'existing first');
    addPacket(packet(2), 'existing latest');
    const existingLatestId = useComparisonStore.getState().packets[1]!.id;

    mergePackets([{ label: 'incoming', packet: packet(3) }]);

    const merged = useComparisonStore.getState().packets;
    expect(merged.map(({ label }) => label)).toEqual(['existing latest', 'incoming']);
    expect(merged[0]!.id).toBe(existingLatestId);
    expect(merged[1]!.id).not.toBe(existingLatestId);
  });
});
