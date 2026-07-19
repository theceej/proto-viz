import { describe, expect, it } from 'vitest';
import { newLayer, type LayerInstance, type StackInstance } from './model';
import { createBuiltinRegistry } from '../protocols';
import { ShareCodeError } from './share';
import { decodePacketBlob, encodePacketBlob } from './shareBlob';

const registry = createBuiltinRegistry();

const layer = (
  protocolId: string,
  overrides: LayerInstance['overrides'] = {},
  pinned: string[] = [],
): LayerInstance => ({ ...newLayer(protocolId), overrides, pinned });

describe('share v2 packet blob', () => {
  it('returns null when there is nothing beyond the structure', () => {
    const stack: StackInstance = { layers: [layer('ethernet'), layer('ipv4'), layer('tcp')] };
    expect(encodePacketBlob(stack, registry)).toBeNull();
  });

  it('round-trips field overrides, pinned fields, and payload', () => {
    const stack: StackInstance = {
      layers: [
        layer('ethernet', { dst: '02:00:00:00:00:aa' }),
        layer('ipv4', { ttl: 42, src: '203.0.113.5', totalLength: 1234 }, ['totalLength']),
        layer('tcp', { srcPort: 1234, dstPort: 443 }),
      ],
      trailingPayload: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    };
    const ids = ['ethernet', 'ipv4', 'tcp'];
    const blob = encodePacketBlob(stack, registry)!;
    expect(blob).toBeTypeOf('string');

    const { layers, payload } = decodePacketBlob(blob, ids, registry);
    expect(layers.map((l) => l.protocolId)).toEqual(ids);
    expect(layers[0]!.overrides).toEqual({ dst: '02:00:00:00:00:aa' });
    expect(layers[1]!.overrides).toEqual({ ttl: 42, src: '203.0.113.5', totalLength: 1234 });
    expect(layers[1]!.pinned).toEqual(['totalLength']);
    expect(layers[2]!.overrides).toEqual({ srcPort: 1234, dstPort: 443 });
    expect([...payload]).toEqual([0xde, 0xad, 0xbe, 0xef]);
    // Fresh uids so the loaded stack is independent of the sharer's.
    expect(layers[0]!.uid).not.toBe(stack.layers[0]!.uid);
  });

  it('round-trips each value type, including bytes and dnsName', () => {
    const stack: StackInstance = {
      layers: [
        layer('ethernet', { dst: '02:00:00:00:00:01', src: '02:00:00:00:00:02' }),
        layer('ipv6', { src: '2001:db8::1', dst: '2001:db8::abcd', hopLimit: 200 }),
        layer('udp'),
        layer('dns', { qname: 'foo.example.com' }),
      ],
    };
    const ids = ['ethernet', 'ipv6', 'udp', 'dns'];
    const { layers } = decodePacketBlob(encodePacketBlob(stack, registry)!, ids, registry);
    expect(layers[0]!.overrides).toEqual({ dst: '02:00:00:00:00:01', src: '02:00:00:00:00:02' });
    expect(layers[1]!.overrides).toEqual({ src: '2001:db8::1', dst: '2001:db8::abcd', hopLimit: 200 });
    expect(layers[3]!.overrides).toEqual({ qname: 'foo.example.com' });
  });

  it('round-trips a bytes-typed field override', () => {
    const stack: StackInstance = {
      layers: [layer('ethernet'), layer('ipv4', { options: new Uint8Array([1, 2, 3, 4]) })],
    };
    const { layers } = decodePacketBlob(
      encodePacketBlob(stack, registry)!,
      ['ethernet', 'ipv4'],
      registry,
    );
    expect(layers[1]!.overrides.options).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('encodes payload with no field edits', () => {
    const stack: StackInstance = {
      layers: [layer('ethernet'), layer('ipv4'), layer('udp')],
      trailingPayload: new Uint8Array([1, 2, 3, 4, 5]),
    };
    const { layers, payload } = decodePacketBlob(
      encodePacketBlob(stack, registry)!,
      ['ethernet', 'ipv4', 'udp'],
      registry,
    );
    expect(layers.every((l) => Object.keys(l.overrides).length === 0)).toBe(true);
    expect([...payload]).toEqual([1, 2, 3, 4, 5]);
  });

  it('rejects an oversized payload with a clear message', () => {
    const stack: StackInstance = {
      layers: [layer('ethernet'), layer('ipv4'), layer('udp')],
      trailingPayload: new Uint8Array(2000),
    };
    expect(() => encodePacketBlob(stack, registry)).toThrow(ShareCodeError);
    expect(() => encodePacketBlob(stack, registry)).toThrow(/too large/);
  });

  it('rejects a corrupted blob via the checksum', () => {
    const stack: StackInstance = {
      layers: [layer('ethernet'), layer('ipv4', { ttl: 42 })],
    };
    const blob = encodePacketBlob(stack, registry)!;
    // Flip a character in the middle of the base64url body.
    const mid = Math.floor(blob.length / 2);
    const swap = blob[mid] === 'A' ? 'B' : 'A';
    const tampered = blob.slice(0, mid) + swap + blob.slice(mid + 1);
    expect(() => decodePacketBlob(tampered, ['ethernet', 'ipv4'], registry)).toThrow(ShareCodeError);
  });

  it('rejects a blob whose layer index does not fit the structure', () => {
    const stack: StackInstance = {
      layers: [layer('ethernet'), layer('ipv4', { ttl: 42 })],
    };
    const blob = encodePacketBlob(stack, registry)!;
    // Decoding against a shorter structure than the blob references.
    expect(() => decodePacketBlob(blob, ['ethernet'], registry)).toThrow(ShareCodeError);
  });
});
