import { describe, expect, it } from 'vitest';
import { newLayer, type StackInstance } from './model';
import { SerializeError, serializeStack } from './serialize';
import { createBuiltinRegistry } from '../protocols';

const registry = createBuiltinRegistry();

const stack = (ids: string[], payload?: Uint8Array): StackInstance => ({
  layers: ids.map(newLayer),
  trailingPayload: payload,
});

describe('serializeStack edge cases', () => {
  it('throws on an unknown protocol id', () => {
    expect(() => serializeStack(stack(['nope']), registry)).toThrow(SerializeError);
  });

  it('reports an invalid field override as an issue instead of crashing', () => {
    const s = stack(['ethernet', 'ipv4']);
    s.layers[0]!.overrides['dst'] = 'not-a-mac';
    const result = serializeStack(s, registry);
    const err = result.issues.find((i) => i.severity === 'error')!;
    expect(err.message).toContain('Destination MAC');
    expect(err.message).toContain('invalid MAC');
    // the bad field is dropped from the Ethernet layer's layout
    // (IPv4 has its own 'dst' field, so scope the check to layer 0)
    const ethUid = s.layers[0]!.uid;
    expect(result.spans.some((sp) => sp.layerUid === ethUid && sp.fieldId === 'dst')).toBe(false);
  });

  it('keeps a pinned checksum byte-exact and warns about the correct value', () => {
    const s = stack(['ethernet', 'ipv4']);
    s.layers[1]!.overrides['headerChecksum'] = 0xdead;
    s.layers[1]!.pinned = ['headerChecksum'];
    const result = serializeStack(s, registry);
    expect((result.bytes[24]! << 8) | result.bytes[25]!).toBe(0xdead);
    const warn = result.issues.find((i) => i.severity === 'warning')!;
    expect(warn.message).toContain('0xdead');
    expect(warn.message).toContain('correct checksum');
  });

  it('places trailing payload after all headers', () => {
    const payload = Uint8Array.from([1, 2, 3, 4, 5]);
    const result = serializeStack(stack(['ethernet', 'ipv4', 'udp'], payload), registry);
    expect(result.payloadOffset).toBe(14 + 20 + 8);
    expect([...result.bytes.slice(result.payloadOffset)]).toEqual([...payload]);
    expect(result.bytes.length).toBe(result.payloadOffset + payload.length);
  });

  it('gives duplicate protocols distinct spans via layer uids', () => {
    const s = stack(['ethernet', 'ipv4', 'gre', 'ipv4', 'icmp']);
    const result = serializeStack(s, registry);
    const ttls = result.spans.filter((sp) => sp.fieldId === 'ttl');
    expect(ttls).toHaveLength(2);
    expect(ttls[0]!.layerUid).not.toBe(ttls[1]!.layerUid);
    expect(ttls[0]!.bitOffset).not.toBe(ttls[1]!.bitOffset);
    // both IPv4 headers carry valid, independent checksums
    const cks = result.spans.filter((sp) => sp.fieldId === 'headerChecksum');
    expect(cks).toHaveLength(2);
    expect(cks[0]!.value).not.toBe(0);
    expect(cks[1]!.value).not.toBe(0);
  });

  it('serializes 64-bit uint fields from bigint defaults (NTP timestamp)', () => {
    const result = serializeStack(stack(['ethernet', 'ipv4', 'udp', 'ntp']), registry);
    const tx = result.spans.find((sp) => sp.fieldId === 'txTimestamp')!;
    expect(tx.bitLength).toBe(64);
    const start = tx.bitOffset / 8;
    expect([...result.bytes.slice(start, start + 8)]).toEqual([
      0xec, 0x4b, 0xd5, 0x1c, 0, 0, 0, 0,
    ]);
  });

  it('UDP checksum zero-substitution rule leaves a nonzero checksum', () => {
    // Whatever the payload, an all-ones-complement UDP checksum must never
    // be transmitted as 0x0000 (RFC 768).
    for (const payload of ['', 'a', 'test', '\xff\xff']) {
      const s = stack(['ethernet', 'ipv4', 'udp'], new TextEncoder().encode(payload));
      const result = serializeStack(s, registry);
      const ck = result.spans.find((sp) => sp.fieldId === 'checksum')!;
      expect(ck.value).not.toBe(0);
    }
  });

  it('binding fields fall back to their default when nothing follows', () => {
    const result = serializeStack(stack(['ethernet']), registry);
    expect((result.bytes[12]! << 8) | result.bytes[13]!).toBe(0x0800); // default EtherType
  });

  it('an empty stack serializes to zero bytes', () => {
    const result = serializeStack({ layers: [] }, registry);
    expect(result.bytes.length).toBe(0);
    expect(result.spans).toEqual([]);
    expect(result.layers).toEqual([]);
  });
});
