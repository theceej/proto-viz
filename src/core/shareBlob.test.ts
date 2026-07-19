import { describe, expect, it } from 'vitest';
import { newLayer, type LayerInstance, type StackInstance } from './model';
import { createBuiltinRegistry } from '../protocols';
import { ShareCodeError, crc8 } from './share';
import { decodePacketBlob, encodePacketBlob } from './shareBlob';

const registry = createBuiltinRegistry();

const layer = (
  protocolId: string,
  overrides: LayerInstance['overrides'] = {},
  pinned: string[] = [],
): LayerInstance => ({ ...newLayer(protocolId), overrides, pinned });

/** Base64url-encode a raw byte body plus its CRC-8, as the real encoder does. */
const craftBlob = (body: number[]): string => {
  const bytes = [...body, crc8(body)];
  const bin = String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

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

  it('round-trips a payload large enough to need a multi-byte varint length', () => {
    const payload = Uint8Array.from({ length: 200 }, (_, i) => i & 0xff);
    const stack: StackInstance = { layers: [layer('ethernet'), layer('ipv4'), layer('udp')], trailingPayload: payload };
    const { payload: out } = decodePacketBlob(
      encodePacketBlob(stack, registry)!,
      ['ethernet', 'ipv4', 'udp'],
      registry,
    );
    expect([...out]).toEqual([...payload]);
  });

  it('round-trips a 64-bit bigint override beyond MAX_SAFE_INTEGER', () => {
    const big = 0xffffffffffffffn; // 2^56 - 1, decodes back as a bigint
    const stack: StackInstance = {
      layers: [layer('ethernet'), layer('ipv4'), layer('udp'), layer('ntp', { txTimestamp: big })],
    };
    const { layers } = decodePacketBlob(
      encodePacketBlob(stack, registry)!,
      ['ethernet', 'ipv4', 'udp', 'ntp'],
      registry,
    );
    expect(layers[3]!.overrides.txTimestamp).toBe(big);
  });

  it('encodes a pinned field that has no override value', () => {
    const stack: StackInstance = { layers: [layer('ethernet'), layer('ipv4', {}, ['ihl'])] };
    const { layers } = decodePacketBlob(
      encodePacketBlob(stack, registry)!,
      ['ethernet', 'ipv4'],
      registry,
    );
    expect(layers[1]!.pinned).toEqual(['ihl']);
    expect(layers[1]!.overrides).toEqual({});
  });

  it('drops overrides for field ids the protocol does not have', () => {
    const stack: StackInstance = {
      layers: [layer('ethernet', { dst: '02:00:00:00:00:aa', bogusField: 5 as unknown as number })],
    };
    const { layers } = decodePacketBlob(
      encodePacketBlob(stack, registry)!,
      ['ethernet'],
      registry,
    );
    expect(layers[0]!.overrides).toEqual({ dst: '02:00:00:00:00:aa' });
  });

  it('skips a layer whose protocol is not in the registry when encoding', () => {
    const stack: StackInstance = {
      layers: [layer('does-not-exist', { x: 1 as unknown as number }), layer('ethernet', { dst: '02:00:00:00:00:bb' })],
    };
    // The unknown layer is skipped rather than crashing the encode.
    expect(encodePacketBlob(stack, registry)).toBeTypeOf('string');
  });

  it('rejects data that is not valid base64url', () => {
    expect(() => decodePacketBlob('!!!not-base64!!!', ['ethernet'], registry)).toThrow(/not valid/);
  });

  it('rejects a blob that is too short to hold a version and checksum', () => {
    // Single byte -> length < 2.
    expect(() => decodePacketBlob(btoa('\x00'), ['ethernet'], registry)).toThrow(/truncated/);
  });

  it('rejects a blob from a newer format version', () => {
    // version byte 99 with a valid checksum.
    expect(() => decodePacketBlob(craftBlob([99]), ['ethernet'], registry)).toThrow(/newer version/);
  });

  it('rejects a field ordinal the protocol does not have', () => {
    // v2, 1 edited layer, index 0, 1 entry, ordinal 250 (out of range), flags 0, payload len 0.
    const blob = craftBlob([2, 1, 0, 1, 250, 0, 0]);
    expect(() => decodePacketBlob(blob, ['ethernet'], registry)).toThrow(/do not match/);
  });

  it('rejects a blob that claims more layers than it carries', () => {
    // v2 header says 5 edited layers, but no layer data follows.
    expect(() => decodePacketBlob(craftBlob([2, 5]), ['ethernet'], registry)).toThrow(/truncated/);
  });
});
