import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../protocols/index';
import { newLayer, type LayerInstance, type StackInstance } from './model';
import { serializeStack, type SerializedPacket } from './serialize';
import { applyByteEdit } from './editByte';

const registry = createBuiltinRegistry();

/** Build an Ethernet › IPv4 › TCP stack + its serialized packet for editing. */
function build(overrides: Record<number, Record<string, unknown>> = {}, payload?: Uint8Array): {
  stack: StackInstance;
  packet: SerializedPacket;
} {
  const stack: StackInstance = {
    layers: ['ethernet', 'ipv4', 'tcp'].map((id, i) => ({
      ...newLayer(id),
      overrides: (overrides[i] ?? {}) as Record<string, never>,
      pinned: [],
    })),
    trailingPayload: payload ?? new Uint8Array(0),
  };
  const packet = serializeStack(stack, registry);
  expect(packet.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  return { stack, packet };
}

const ipv4Of = (layers: LayerInstance[]) => layers.find((l) => l.protocolId === 'ipv4')!;

// Byte offsets in Ethernet(14) › IPv4 › TCP:
const IPV4_VERSION_IHL = 14;
const IPV4_TTL = 22;
const IPV4_CHECKSUM = 24;
const IPV4_SRC = 26;

describe('applyByteEdit', () => {
  it('overrides a plain field from the edited bytes without pinning it', () => {
    const { stack, packet } = build({ 1: { src: '192.0.2.99' } });
    const result = applyByteEdit(stack, packet, registry, IPV4_SRC, 10);
    expect(result).not.toBeNull();
    const ipv4 = ipv4Of(result!.layers);
    expect(ipv4.overrides.src).toBe('10.0.2.99');
    expect(ipv4.pinned).not.toContain('src');
  });

  it('pins a computed field when its own bytes are edited', () => {
    const { stack, packet } = build();
    const original = packet.bytes[IPV4_CHECKSUM]!;
    const result = applyByteEdit(stack, packet, registry, IPV4_CHECKSUM, original ^ 0xff);
    expect(result).not.toBeNull();
    const ipv4 = ipv4Of(result!.layers);
    expect(ipv4.pinned).toContain('headerChecksum');
    // The pinned value survives re-serialization.
    const reserialized = serializeStack({ ...stack, layers: result!.layers }, registry);
    expect(reserialized.bytes[IPV4_CHECKSUM]).toBe(original ^ 0xff);
  });

  it('leaves an untouched computed field to recompute after a data edit', () => {
    const { stack, packet } = build();
    const result = applyByteEdit(stack, packet, registry, IPV4_TTL, 7);
    expect(result).not.toBeNull();
    const ipv4 = ipv4Of(result!.layers);
    expect(ipv4.overrides.ttl).toBe(7);
    expect(ipv4.pinned).not.toContain('headerChecksum');
    // Editing the TTL changes the header, so the checksum recomputes on its own.
    const reserialized = serializeStack({ ...stack, layers: result!.layers }, registry);
    expect(reserialized.bytes[IPV4_CHECKSUM]).not.toBe(packet.bytes[IPV4_CHECKSUM]);
  });

  it('only touches the sub-field whose bits changed in a bit-packed byte', () => {
    const { stack, packet } = build();
    // Byte 14 packs version (high nibble, 4) and IHL (low nibble, 5) → 0x45.
    expect(packet.bytes[IPV4_VERSION_IHL]).toBe(0x45);
    const result = applyByteEdit(stack, packet, registry, IPV4_VERSION_IHL, 0x65);
    expect(result).not.toBeNull();
    const ipv4 = ipv4Of(result!.layers);
    expect(ipv4.overrides.version).toBe(6);
    // IHL's nibble is unchanged, so it is neither overridden nor pinned.
    expect(ipv4.overrides).not.toHaveProperty('ihl');
    expect(ipv4.pinned).not.toContain('ihl');
  });

  it('edits a trailing-payload byte and leaves the layers alone', () => {
    const payload = new Uint8Array([0xaa, 0xbb, 0xcc]);
    const { stack, packet } = build({}, payload);
    const target = packet.payloadOffset + 1;
    const result = applyByteEdit(stack, packet, registry, target, 0x99);
    expect(result).not.toBeNull();
    expect(Array.from(result!.trailingPayload)).toEqual([0xaa, 0x99, 0xcc]);
    for (const layer of result!.layers) expect(layer.overrides).toEqual({});
  });

  it('returns null for no-ops and out-of-range or invalid edits', () => {
    const { stack, packet } = build();
    const same = packet.bytes[IPV4_TTL]!;
    expect(applyByteEdit(stack, packet, registry, IPV4_TTL, same)).toBeNull();
    expect(applyByteEdit(stack, packet, registry, -1, 0)).toBeNull();
    expect(applyByteEdit(stack, packet, registry, packet.bytes.length, 0)).toBeNull();
    expect(applyByteEdit(stack, packet, registry, IPV4_TTL, 256)).toBeNull();
    expect(applyByteEdit(stack, packet, registry, IPV4_TTL, -1)).toBeNull();
  });
});
