import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../protocols';
import { newLayer, type StackInstance } from './model';
import { serializeStack, type SerializedPacket } from './serialize';
import {
  FuzzError,
  fuzzPacket,
  isLengthChanging,
  MUTATIONS,
  resolveTarget,
  type FuzzOptions,
  type MutationStrategy,
} from './fuzz';

const registry = createBuiltinRegistry();

function build(payload?: Uint8Array): { stack: StackInstance; packet: SerializedPacket } {
  const stack: StackInstance = {
    layers: ['ethernet', 'ipv4', 'tcp'].map(newLayer),
    trailingPayload: payload ?? Uint8Array.from([0xaa, 0xbb, 0xcc, 0xdd]),
  };
  return { stack, packet: serializeStack(stack, registry) };
}

const fuzz = (options: Partial<FuzzOptions> = {}) => {
  const { stack, packet } = build();
  return fuzzPacket(stack, packet, registry, {
    seed: 1,
    strategy: 'bit-flip',
    count: 3,
    target: { layerUids: [] },
    ...options,
  });
};

/** Byte offsets that differ between two equal-length buffers. */
const changedBytes = (a: Uint8Array, b: Uint8Array): number[] =>
  [...a].flatMap((byte, i) => (byte === b[i] ? [] : [i]));

describe('resolveTarget', () => {
  const { packet } = build();

  it('covers the whole packet when nothing is selected', () => {
    expect(resolveTarget(packet, { layerUids: [] })).toHaveLength(packet.bytes.length);
  });

  it('confines the scope to a chosen layer', () => {
    const ipv4 = packet.layers.find((l) => l.protocolId === 'ipv4')!;
    const offsets = resolveTarget(packet, { layerUids: [ipv4.uid] });

    expect(offsets).toHaveLength(ipv4.headerBytes);
    expect(Math.min(...offsets)).toBe(ipv4.byteOffset);
    expect(Math.max(...offsets)).toBe(ipv4.byteOffset + ipv4.headerBytes - 1);
  });

  it('intersects a layer scope with an explicit byte range', () => {
    const ipv4 = packet.layers.find((l) => l.protocolId === 'ipv4')!;
    const offsets = resolveTarget(packet, {
      layerUids: [ipv4.uid],
      byteRange: { start: ipv4.byteOffset + 2, end: ipv4.byteOffset + 5 },
    });
    expect(offsets).toEqual([
      ipv4.byteOffset + 2,
      ipv4.byteOffset + 3,
      ipv4.byteOffset + 4,
      ipv4.byteOffset + 5,
    ]);
  });

  it('clamps a range that runs past the packet', () => {
    const offsets = resolveTarget(packet, { layerUids: [], byteRange: { start: -5, end: 9999 } });
    expect(offsets[0]).toBe(0);
    expect(offsets.at(-1)).toBe(packet.bytes.length - 1);
  });
});

describe('fuzzPacket reproducibility', () => {
  it('produces identical bytes and mutations for the same seed', () => {
    const a = fuzz({ seed: 4242 });
    const b = fuzz({ seed: 4242 });

    expect([...a.bytes]).toEqual([...b.bytes]);
    expect(a.mutations).toEqual(b.mutations);
  });

  it('produces different results for different seeds', () => {
    const a = fuzz({ seed: 1, count: 6 });
    const b = fuzz({ seed: 2, count: 6 });
    expect([...a.bytes]).not.toEqual([...b.bytes]);
  });

  it('is reproducible for every strategy', () => {
    for (const strategy of MUTATIONS) {
      const options = { strategy, seed: 99, allowLengthChange: true };
      expect([...fuzz(options).bytes], strategy).toEqual([...fuzz(options).bytes]);
    }
  });
});

describe('fuzzPacket scope', () => {
  it('never mutates a byte outside the targeted layer', () => {
    const { stack, packet } = build();
    const tcp = packet.layers.find((l) => l.protocolId === 'tcp')!;

    for (const strategy of ['bit-flip', 'zero', 'boundary'] as MutationStrategy[]) {
      const result = fuzzPacket(stack, packet, registry, {
        seed: 5,
        strategy,
        count: 10,
        target: { layerUids: [tcp.uid] },
      });
      for (const offset of changedBytes(packet.bytes, result.bytes)) {
        expect(offset, `${strategy} byte ${offset}`).toBeGreaterThanOrEqual(tcp.byteOffset);
        expect(offset).toBeLessThan(tcp.byteOffset + tcp.headerBytes);
      }
    }
  });

  it('never mutates a byte outside an explicit range', () => {
    const { stack, packet } = build();
    const result = fuzzPacket(stack, packet, registry, {
      seed: 11,
      strategy: 'zero',
      count: 12,
      target: { layerUids: [], byteRange: { start: 20, end: 25 } },
    });
    for (const offset of changedBytes(packet.bytes, result.bytes)) {
      expect(offset).toBeGreaterThanOrEqual(20);
      expect(offset).toBeLessThanOrEqual(25);
    }
  });

  it('refuses a target that selects no bytes', () => {
    const { stack, packet } = build();
    expect(() =>
      fuzzPacket(stack, packet, registry, {
        seed: 1,
        strategy: 'zero',
        count: 1,
        target: { layerUids: ['no-such-layer'] },
      }),
    ).toThrow(FuzzError);
  });

  it('refuses a request for no mutations', () => {
    expect(() => fuzz({ count: 0 })).toThrow(/at least one/);
  });
});

describe('mutation strategies', () => {
  it('bit-flip changes exactly one bit per mutation', () => {
    const { stack, packet } = build();
    const result = fuzzPacket(stack, packet, registry, {
      seed: 3,
      strategy: 'bit-flip',
      count: 4,
      target: { layerUids: [] },
    });

    for (const offset of changedBytes(packet.bytes, result.bytes)) {
      const differing = packet.bytes[offset]! ^ result.bytes[offset]!;
      // A power of two: one bit set.
      expect(differing & (differing - 1)).toBe(0);
    }
    expect(result.mutations.every((m) => m.bitLength === 1)).toBe(true);
  });

  it('zero writes zero bytes', () => {
    const result = fuzz({ strategy: 'zero', count: 5, seed: 8 });
    const { packet } = build();
    for (const offset of changedBytes(packet.bytes, result.bytes)) {
      expect(result.bytes[offset]).toBe(0);
    }
  });

  it('boundary writes only recognised boundary values', () => {
    const result = fuzz({ strategy: 'boundary', count: 8, seed: 12 });
    const { packet } = build();
    for (const offset of changedBytes(packet.bytes, result.bytes)) {
      expect([0x00, 0xff, 0x7f, 0x80, 0x01, 0xfe]).toContain(result.bytes[offset]);
    }
  });

  it('length-overflow maxes a length field and moves on to another', () => {
    const result = fuzz({ strategy: 'length-overflow', count: 2, seed: 7 });

    expect(result.mutations).toHaveLength(2);
    // Two distinct fields, not the same one twice.
    expect(result.mutations[0]!.description).not.toBe(result.mutations[1]!.description);
    for (const mutation of result.mutations) {
      expect(mutation.description).toMatch(/maximum/);
    }
  });

  it('length-overflow sets only its own bits in a sub-byte field', () => {
    // IPv4's IHL is the low nibble of byte 14; the version nibble beside it
    // must survive being driven to its maximum.
    const { stack, packet } = build();
    const result = fuzzPacket(stack, packet, registry, {
      seed: 7,
      strategy: 'length-overflow',
      count: 1,
      target: { layerUids: [], byteRange: { start: 14, end: 14 } },
    });

    expect(result.bytes[14]! >> 4).toBe(packet.bytes[14]! >> 4); // version untouched
    expect(result.bytes[14]! & 0x0f).toBe(0x0f); // IHL maxed
  });
});

describe('length-changing mutations', () => {
  it('refuses truncate and extend unless explicitly allowed', () => {
    for (const strategy of ['truncate', 'extend'] as MutationStrategy[]) {
      expect(() => fuzz({ strategy }), strategy).toThrow(/enable length-changing/);
      expect(isLengthChanging(strategy)).toBe(true);
    }
  });

  it('truncate shortens the packet and reports no stack', () => {
    const { packet } = build();
    const result = fuzz({ strategy: 'truncate', allowLengthChange: true, seed: 21 });

    expect(result.bytes.length).toBeLessThan(packet.bytes.length);
    expect(result.bytes.length).toBeGreaterThan(0);
    expect(result.lengthChanged).toBe(true);
    expect(result.stack).toBeNull();
    expect(result.foldbackNote).toMatch(/truncated/i);
    // The surviving prefix is untouched.
    expect([...result.bytes]).toEqual([...packet.bytes.slice(0, result.bytes.length)]);
  });

  it('extend appends bytes without disturbing the original', () => {
    const { packet } = build();
    const result = fuzz({ strategy: 'extend', allowLengthChange: true, count: 6, seed: 22 });

    expect(result.bytes.length).toBe(packet.bytes.length + 6);
    expect([...result.bytes.slice(0, packet.bytes.length)]).toEqual([...packet.bytes]);
    expect(result.lengthChanged).toBe(true);
    expect(result.stack).toBeNull();
  });
});

describe('folding back into the stack', () => {
  it('keeps length-preserving results in the stack model', () => {
    const result = fuzz({ strategy: 'zero', count: 3, seed: 31 });

    expect(result.lengthChanged).toBe(false);
    expect(result.stack).not.toBeNull();
    expect(result.stack!.layers.map((l) => l.protocolId)).toEqual(['ethernet', 'ipv4', 'tcp']);
    // The folded-back stack re-serializes to exactly the mutated bytes.
    expect([...serializeStack(result.stack!, registry).bytes]).toEqual([...result.bytes]);
  });

  it('pins computed fields it overwrites so the corruption survives', () => {
    const { stack, packet } = build();
    // Byte 24-25 is the IPv4 header checksum, a computed field.
    const result = fuzzPacket(stack, packet, registry, {
      seed: 2,
      strategy: 'zero',
      count: 4,
      target: { layerUids: [], byteRange: { start: 24, end: 25 } },
    });

    const ipv4 = result.stack!.layers.find((l) => l.protocolId === 'ipv4')!;
    expect(ipv4.pinned).toContain('headerChecksum');
    expect([...serializeStack(result.stack!, registry).bytes]).toEqual([...result.bytes]);
  });

  it('leaves untouched layers completely unchanged', () => {
    const { stack, packet } = build();
    const tcp = packet.layers.find((l) => l.protocolId === 'tcp')!;
    const result = fuzzPacket(stack, packet, registry, {
      seed: 44,
      strategy: 'boundary',
      count: 6,
      target: { layerUids: [tcp.uid] },
    });

    const ethernet = result.stack!.layers.find((l) => l.protocolId === 'ethernet')!;
    const ipv4 = result.stack!.layers.find((l) => l.protocolId === 'ipv4')!;
    expect(ethernet.overrides).toEqual({});
    expect(ethernet.pinned).toEqual([]);
    expect(ipv4.overrides).toEqual({});
    expect(ipv4.pinned).toEqual([]);
  });

  it('mutates payload bytes through the payload, not a field override', () => {
    const { stack, packet } = build(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]));
    const result = fuzzPacket(stack, packet, registry, {
      seed: 6,
      strategy: 'zero',
      count: 4,
      target: { layerUids: [], byteRange: { start: packet.payloadOffset, end: packet.bytes.length - 1 } },
    });

    expect(result.stack!.trailingPayload).not.toEqual(stack.trailingPayload);
    // The only overrides allowed here are pinned computed fields: corrupting
    // the payload invalidates the TCP checksum, and keeping the stale value
    // is the whole point — a bit flip in transit does not repair a checksum.
    for (const layer of result.stack!.layers) {
      for (const fieldId of Object.keys(layer.overrides)) {
        expect(layer.pinned, `${layer.protocolId}.${fieldId}`).toContain(fieldId);
      }
    }
  });

  it('keeps a stale checksum rather than silently recomputing it', () => {
    const { stack, packet } = build(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]));
    const result = fuzzPacket(stack, packet, registry, {
      seed: 6,
      strategy: 'zero',
      count: 4,
      target: { layerUids: [], byteRange: { start: packet.payloadOffset, end: packet.bytes.length - 1 } },
    });

    // What is exported must be what is displayed.
    expect([...serializeStack(result.stack!, registry).bytes]).toEqual([...result.bytes]);
    const tcp = result.stack!.layers.find((l) => l.protocolId === 'tcp')!;
    expect(tcp.pinned).toContain('checksum');
  });
});

describe('mutation reporting', () => {
  it('describes every mutation and points at the bits it changed', () => {
    const { packet } = build();
    const result = fuzz({ strategy: 'bit-flip', count: 3, seed: 15 });

    expect(result.mutations.length).toBeGreaterThan(0);
    for (const mutation of result.mutations) {
      expect(mutation.description).not.toBe('');
      expect(mutation.bitOffset).toBeGreaterThanOrEqual(0);
      expect(mutation.bitOffset + mutation.bitLength).toBeLessThanOrEqual(packet.bytes.length * 8);
    }
  });
});
