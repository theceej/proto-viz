import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../protocols';
import { decodeStackBytes, type DecodedStack } from './decodeStack';
import { newLayer, type StackInstance } from './model';
import { serializeStack } from './serialize';

const registry = createBuiltinRegistry();
const SEED = 0x58dec0de;
const ITERATIONS = 2000;
const MAX_INPUT_BYTES = 512;
const TIME_BUDGET_MS = 2500;

/** Deterministic PRNG so every failure can be reproduced from the seed. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBytes(rand: () => number, length: number): Uint8Array {
  return Uint8Array.from({ length }, () => Math.floor(rand() * 256));
}

function stackBytes(protocolIds: string[], payloadLength: number): Uint8Array {
  const stack: StackInstance = {
    layers: protocolIds.map((id) => newLayer(id)),
    trailingPayload: Uint8Array.from({ length: payloadLength }, (_, i) => (i * 37) & 0xff),
  };
  const packet = serializeStack(stack, registry);
  expect(packet.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  return packet.bytes;
}

function decodedStack(result: DecodedStack): StackInstance {
  return {
    layers: result.layers.map((layer) => ({
      ...newLayer(layer.protocolId),
      overrides: layer.overrides,
      pinned: layer.pinned,
    })),
    trailingPayload: result.payload,
  };
}

function assertDecodeInvariants(input: Uint8Array, startProtocolId: string) {
  const decoded = decodeStackBytes(input, registry, startProtocolId);
  expect(decoded.layers.length).toBeLessThanOrEqual(64);
  expect(decoded.payload.length).toBeLessThanOrEqual(input.length);

  if (decoded.layers.length === 0) return;
  const packet = serializeStack(decodedStack(decoded), registry);
  const spans = [...packet.spans].sort((a, b) => a.bitOffset - b.bitOffset);
  let previousEnd = 0;
  for (const span of spans) {
    expect(Number.isInteger(span.bitOffset)).toBe(true);
    expect(Number.isInteger(span.bitLength)).toBe(true);
    expect(span.bitLength).toBeGreaterThan(0);
    expect(span.bitOffset).toBeGreaterThanOrEqual(previousEnd);
    // Non-exact decodes may intentionally rebuild to a different size after a
    // corrupt wire length. Every returned serialization span must still be
    // bounded by the buffer that owns it.
    expect(span.bitOffset + span.bitLength).toBeLessThanOrEqual(packet.bytes.length * 8);
    previousEnd = span.bitOffset + span.bitLength;
  }

  if (decoded.exact) expect(packet.bytes).toEqual(input);
}

describe('decodeStackBytes fuzz properties', () => {
  it(
    'safely decodes arbitrary and damaged plausible packets within a bounded time',
    () => {
      const rand = mulberry32(SEED);
      const plausible = [
        stackBytes(['ethernet', 'ipv4', 'tcp'], 32),
        stackBytes(['ethernet', 'ipv4', 'udp', 'dns'], 12),
        stackBytes(['ethernet', 'ipv6', 'udp'], 24),
        stackBytes(['ethernet', 'vlan-8021q', 'ipv4', 'icmp'], 16),
      ];
      const starts = ['ethernet', 'ipv4', 'ipv6'];
      const startedAt = performance.now();

      for (let i = 0; i < ITERATIONS; i++) {
        let input: Uint8Array;
        let start = starts[Math.floor(rand() * starts.length)]!;
        if (i % 2 === 0) {
          input = randomBytes(rand, Math.floor(rand() * (MAX_INPUT_BYTES + 1)));
        } else {
          const base = plausible[Math.floor(rand() * plausible.length)]!;
          const kept = Math.floor(rand() * (base.length + 1));
          const suffixLength = Math.floor(rand() * 17);
          input = new Uint8Array(kept + suffixLength);
          input.set(base.subarray(0, kept));
          input.set(randomBytes(rand, suffixLength), kept);
          start = 'ethernet';

          // Occasionally corrupt a length/selector byte in the retained prefix.
          if (input.length > 0 && i % 3 === 0) {
            input[Math.floor(rand() * input.length)] = Math.floor(rand() * 256);
          }
        }

        assertDecodeInvariants(input, start);
      }

      expect(performance.now() - startedAt).toBeLessThan(TIME_BUDGET_MS);
    },
    5000,
  );
});
