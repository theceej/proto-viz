import { describe, expect, it } from 'vitest';
import { comparePackets } from './comparePackets';
import type { SerializedPacket } from './serialize';

function packet(
  layers: { uid: string; protocolId: string }[],
  fields: { layerUid: string; fieldId: string; value: number; computed?: boolean }[],
  bytes: number[],
): SerializedPacket {
  return {
    bytes: Uint8Array.from(bytes),
    layers: layers.map((layer, index) => ({ ...layer, byteOffset: index, headerBytes: 1 })),
    spans: fields.map((field, index) => ({
      ...field,
      bitOffset: index * 8,
      bitLength: 8,
      computed: field.computed ?? false,
      pinned: false,
    })),
    payloadOffset: bytes.length,
    issues: [],
  };
}

describe('comparePackets', () => {
  it('aligns repeated protocol layers by occurrence and fields by id', () => {
    const left = packet(
      [{ uid: 'l1', protocolId: 'ipv4' }, { uid: 'l2', protocolId: 'ipv4' }],
      [{ layerUid: 'l1', fieldId: 'ttl', value: 64 }, { layerUid: 'l2', fieldId: 'ttl', value: 32 }],
      [64, 32],
    );
    const right = packet(
      [{ uid: 'r1', protocolId: 'ipv4' }, { uid: 'r2', protocolId: 'ipv4' }],
      [{ layerUid: 'r1', fieldId: 'ttl', value: 63 }, { layerUid: 'r2', fieldId: 'ttl', value: 32 }],
      [63, 32],
    );

    const result = comparePackets(left, right);
    expect(result.layers.map((layer) => layer.key)).toEqual(['ipv4:0', 'ipv4:1']);
    expect(result.layers[0]!.fields[0]!.status).toBe('changed');
    expect(result.layers[1]!.fields[0]!.status).toBe('unchanged');
  });

  it('marks added and removed layers and fields distinctly', () => {
    const left = packet([{ uid: 'udp', protocolId: 'udp' }], [{ layerUid: 'udp', fieldId: 'length', value: 8 }], [8]);
    const right = packet([{ uid: 'tcp', protocolId: 'tcp' }], [{ layerUid: 'tcp', fieldId: 'flags', value: 2 }], [2]);
    const result = comparePackets(left, right);
    expect(result.layers.map((layer) => layer.status)).toEqual(['removed', 'added']);
    expect(result.layers[0]!.fields[0]!.status).toBe('removed');
    expect(result.layers[1]!.fields[0]!.status).toBe('added');
  });

  it('counts computed changes separately and links byte changes to fields', () => {
    const left = packet([{ uid: 'a', protocolId: 'udp' }], [
      { layerUid: 'a', fieldId: 'port', value: 53 },
      { layerUid: 'a', fieldId: 'checksum', value: 1, computed: true },
    ], [53, 1]);
    const right = packet([{ uid: 'b', protocolId: 'udp' }], [
      { layerUid: 'b', fieldId: 'port', value: 5353 },
      { layerUid: 'b', fieldId: 'checksum', value: 2, computed: true },
    ], [54, 2]);
    const result = comparePackets(left, right);
    expect(result.editableChanges).toBe(1);
    expect(result.computedChanges).toBe(1);
    expect(result.bytes.map((byte) => byte.status)).toEqual(['changed', 'changed']);
    expect(result.bytes.map((byte) => byte.fieldKey)).toEqual(['udp:0:port', 'udp:0:checksum']);
  });

  it('compares byte-array field values by content', () => {
    const base = packet([{ uid: 'a', protocolId: 'x' }], [], [1]);
    base.spans = [{ layerUid: 'a', fieldId: 'data', value: Uint8Array.from([1, 2]), bitOffset: 0, bitLength: 8, computed: false, pinned: false }];
    const other = { ...base, spans: [{ ...base.spans[0]!, value: Uint8Array.from([1, 2]) }] };
    expect(comparePackets(base, other).layers[0]!.fields[0]!.status).toBe('unchanged');
  });
});
