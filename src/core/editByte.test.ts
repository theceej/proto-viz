import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../protocols/index';
import { newLayer, type LayerInstance, type StackInstance } from './model';
import { serializeStack, type SerializedPacket } from './serialize';
import { applyByteEdit, applyByteEdits, type ByteEditResult } from './editByte';
import { receiverChecksumFindings } from './receiverChecksum';

const registry = createBuiltinRegistry();

/** Build an Ethernet › IPv4 › TCP stack + its serialized packet for editing. */
function build(overrides: Record<number, Record<string, unknown>> = {}, payload?: Uint8Array): {
  stack: StackInstance;
  packet: SerializedPacket;
} {
  return buildOf(['ethernet', 'ipv4', 'tcp'], overrides, payload);
}

/** The same, for stacks other than the Ethernet › IPv4 › TCP default. */
function buildOf(
  protocolIds: string[],
  overrides: Record<number, Record<string, unknown>> = {},
  payload?: Uint8Array,
): { stack: StackInstance; packet: SerializedPacket } {
  const stack: StackInstance = {
    layers: protocolIds.map((id, i) => ({
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

/**
 * #152: a transport checksum covers an IP pseudo-header, so bytes belonging to
 * one layer decide a computed field in another. These cover what the hex editor
 * has to get right across that boundary — which field a byte belongs to, which
 * computed fields must follow it, and which must be pinned instead.
 */
describe('pseudo-header checksums across layers', () => {
  const layerOf = (stack: StackInstance, protocolId: string) =>
    stack.layers.find((layer) => layer.protocolId === protocolId)!;

  const spanOf = (stack: StackInstance, packet: SerializedPacket, protocolId: string, fieldId: string) =>
    packet.spans.find(
      (span) => span.layerUid === layerOf(stack, protocolId).uid && span.fieldId === fieldId,
    )!;

  const offsetOf = (...args: Parameters<typeof spanOf>) => spanOf(...args).bitOffset / 8;
  const valueOf = (...args: Parameters<typeof spanOf>) => Number(spanOf(...args).value);

  /** Re-serialize the result of an edit, as the Builder does after every edit. */
  const reserialize = (stack: StackInstance, result: ByteEditResult) =>
    serializeStack({ ...stack, layers: result.layers, trailingPayload: result.trailingPayload }, registry);

  it('recomputes the TCP checksum when an IPv4 address byte is edited', () => {
    // The byte belongs to IPv4, but it is an input to TCP's checksum through
    // the pseudo-header — so both the IPv4 header checksum and the TCP checksum
    // have to move, while neither is pinned.
    const { stack, packet } = build();
    const srcOffset = offsetOf(stack, packet, 'ipv4', 'src');
    const result = applyByteEdit(stack, packet, registry, srcOffset, packet.bytes[srcOffset]! ^ 0xff);
    expect(result).not.toBeNull();

    const ipv4 = ipv4Of(result!.layers);
    expect(ipv4.pinned).toEqual([]);
    const after = reserialize(stack, result!);
    expect(valueOf(stack, after, 'tcp', 'checksum')).not.toBe(valueOf(stack, packet, 'tcp', 'checksum'));
    expect(valueOf(stack, after, 'ipv4', 'headerChecksum')).not.toBe(
      valueOf(stack, packet, 'ipv4', 'headerChecksum'),
    );
  });

  it('recomputes an IPv6-carried checksum when an IPv6 address byte is edited', () => {
    // 128-bit address spans, and two different transports over them.
    for (const transport of ['tcp', 'icmpv6']) {
      const { stack, packet } = buildOf(['ethernet', 'ipv6', transport]);
      const srcOffset = offsetOf(stack, packet, 'ipv6', 'src');
      const result = applyByteEdit(stack, packet, registry, srcOffset, packet.bytes[srcOffset]! ^ 0xff);
      expect(result).not.toBeNull();

      // The address is a plain field: overridden, never pinned.
      const ipv6 = result!.layers.find((l) => l.protocolId === 'ipv6')!;
      expect(ipv6.pinned).toEqual([]);
      expect(String(ipv6.overrides['src'])).not.toBe('2001:db8::1');

      const after = reserialize(stack, result!);
      expect(valueOf(stack, after, transport, 'checksum')).not.toBe(
        valueOf(stack, packet, transport, 'checksum'),
      );
    }
  });

  it('recomputes the transport checksum, but not IPv4’s, for a payload byte', () => {
    // The IPv4 header checksum covers the header only, so it must not move.
    const { stack, packet } = build({}, Uint8Array.from([1, 2, 3, 4]));
    const result = applyByteEdit(stack, packet, registry, packet.payloadOffset, 0xee);
    expect(result).not.toBeNull();

    const after = reserialize(stack, result!);
    expect(valueOf(stack, after, 'tcp', 'checksum')).not.toBe(valueOf(stack, packet, 'tcp', 'checksum'));
    expect(valueOf(stack, after, 'ipv4', 'headerChecksum')).toBe(
      valueOf(stack, packet, 'ipv4', 'headerChecksum'),
    );
  });

  it('pins a hand-edited TCP checksum and keeps it through an unrelated edit', () => {
    // Type over the checksum, then edit an address. The pinned value is the
    // whole point of hex editing: it must survive the re-serialization that the
    // address edit triggers, even though that edit changes its correct value.
    const { stack, packet } = build();
    const checksumOffset = offsetOf(stack, packet, 'tcp', 'checksum');
    const pinned = applyByteEdits(
      stack,
      packet,
      registry,
      new Map([[checksumOffset, 0xde], [checksumOffset + 1, 0xad]]),
    );
    expect(pinned).not.toBeNull();
    const tcp = pinned!.layers.find((l) => l.protocolId === 'tcp')!;
    expect(tcp.pinned).toContain('checksum');
    expect(tcp.overrides['checksum']).toBe(0xdead);

    const withPin = { ...stack, layers: pinned!.layers };
    const repacked = serializeStack(withPin, registry);
    const srcOffset = offsetOf(stack, repacked, 'ipv4', 'src');
    const result = applyByteEdit(withPin, repacked, registry, srcOffset, repacked.bytes[srcOffset]! ^ 0xff);
    expect(result).not.toBeNull();

    const after = reserialize(withPin, result!);
    expect(valueOf(stack, after, 'tcp', 'checksum')).toBe(0xdead);
    // Exactly one complaint: the checksum the user deliberately pinned.
    const warnings = after.issues.filter((issue) => issue.message.includes('Checksum'));
    expect(warnings).toHaveLength(1);
  });

  it('folds edits in two layers at once without pinning either checksum', () => {
    const { stack, packet } = build();
    const srcOffset = offsetOf(stack, packet, 'ipv4', 'src');
    const portOffset = offsetOf(stack, packet, 'tcp', 'srcPort');
    const result = applyByteEdits(
      stack,
      packet,
      registry,
      new Map([[srcOffset, 10], [portOffset + 1, 0x99]]),
    );
    expect(result).not.toBeNull();

    expect(String(ipv4Of(result!.layers).overrides['src'])).toMatch(/^10\./);
    const tcp = result!.layers.find((l) => l.protocolId === 'tcp')!;
    expect(Number(tcp.overrides['srcPort']) & 0xff).toBe(0x99);
    // Both checksums are still free to recompute; neither byte was theirs.
    expect(ipv4Of(result!.layers).pinned).toEqual([]);
    expect(tcp.pinned).toEqual([]);
    expect(reserialize(stack, result!).issues).toEqual([]);
  });

  it('leaves the transport checksum alone when a length field is edited', () => {
    // Deliberate, and the reason receiverChecksum.ts exists: the serializer
    // builds the pseudo-header from the packet's true size, as a sender does.
    // Editing Total Length pins a lie into the header without touching the
    // checksum the sender already computed — so the bytes stay self-consistent
    // and the divergence is reported rather than silently absorbed.
    const { stack, packet } = build();
    const lengthOffset = offsetOf(stack, packet, 'ipv4', 'totalLength');
    const result = applyByteEdit(stack, packet, registry, lengthOffset + 1, packet.bytes[lengthOffset + 1]! + 20);
    expect(result).not.toBeNull();

    const ipv4 = ipv4Of(result!.layers);
    expect(ipv4.pinned).toContain('totalLength');
    const after = reserialize(stack, result!);
    expect(valueOf(stack, after, 'tcp', 'checksum')).toBe(valueOf(stack, packet, 'tcp', 'checksum'));

    // What a receiver makes of it is where the edit shows up.
    const findings = receiverChecksumFindings(
      { ...stack, layers: result!.layers },
      registry,
      after,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.cause).toContain('Total Length');
  });
});

describe('applyByteEdits', () => {
  it('applies every edit in one pass', () => {
    const { stack, packet } = build();
    const result = applyByteEdits(
      stack,
      packet,
      registry,
      new Map([
        [IPV4_TTL, 9],
        [IPV4_SRC, 10],
      ]),
    );

    const ipv4 = ipv4Of(result!.layers);
    expect(ipv4.overrides['ttl']).toBe(9);
    expect(String(ipv4.overrides['src'])).toMatch(/^10\./);
  });

  it('reads a field spanning several edited bytes once, from the final buffer', () => {
    // Both halves of the 16-bit checksum change; the field must end up with
    // the value those two bytes make together, not the first edit's reading.
    const { stack, packet } = build();
    const result = applyByteEdits(
      stack,
      packet,
      registry,
      new Map([
        [IPV4_CHECKSUM, 0xab],
        [IPV4_CHECKSUM + 1, 0xcd],
      ]),
    );

    const ipv4 = ipv4Of(result!.layers);
    expect(ipv4.overrides['headerChecksum']).toBe(0xabcd);
    expect(ipv4.pinned).toContain('headerChecksum');
  });

  it('leaves fields whose bits no edit touched exactly as they were', () => {
    const { stack, packet } = build({ 1: { ttl: 33 } });
    const result = applyByteEdits(stack, packet, registry, new Map([[IPV4_SRC, 10]]));

    const ipv4 = ipv4Of(result!.layers);
    expect(ipv4.overrides['ttl']).toBe(33);
    expect(ipv4.pinned).toEqual([]);
  });

  it('edits header and payload bytes together', () => {
    const { stack, packet } = build({}, Uint8Array.from([1, 2, 3, 4]));
    const result = applyByteEdits(
      stack,
      packet,
      registry,
      new Map([
        [IPV4_TTL, 5],
        [packet.payloadOffset + 2, 0xee],
      ]),
    );

    expect(ipv4Of(result!.layers).overrides['ttl']).toBe(5);
    expect([...result!.trailingPayload]).toEqual([1, 2, 0xee, 4]);
  });

  it('ignores out-of-range and no-op entries, and returns null when all are', () => {
    const { stack, packet } = build();
    const current = packet.bytes[IPV4_TTL]!;

    expect(
      applyByteEdits(stack, packet, registry, new Map([[IPV4_TTL, current]])),
    ).toBeNull();
    expect(
      applyByteEdits(stack, packet, registry, new Map([[9999, 1], [-1, 2]])),
    ).toBeNull();

    // A valid edit alongside ignorable ones still applies.
    const mixed = applyByteEdits(
      stack,
      packet,
      registry,
      new Map([[9999, 1], [IPV4_TTL, current === 7 ? 8 : 7]]),
    );
    expect(mixed).not.toBeNull();
  });
});
