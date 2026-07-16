import { describe, expect, it } from 'vitest';
import { mulberry32, randomPayload, randomStack } from './random';
import { validateStack } from './validate';
import { serializeStack } from './serialize';
import { planExport } from './exporter';
import { createBuiltinRegistry } from '../protocols';

const registry = createBuiltinRegistry();

describe('randomStack (property tests, seeded)', () => {
  it('always produces stacks with no validation errors', () => {
    for (let seed = 0; seed < 200; seed++) {
      const stack = randomStack(registry, { rng: mulberry32(seed) });
      const errors = validateStack(stack, registry).filter((i) => i.severity === 'error');
      expect(errors, `seed ${seed}: ${stack.layers.map((l) => l.protocolId).join('>')}`)
        .toEqual([]);
    }
  });

  it('always produces stacks that serialize without error issues', () => {
    for (let seed = 0; seed < 200; seed++) {
      const stack = randomStack(registry, { rng: mulberry32(seed) });
      const packet = serializeStack(stack, registry);
      const errors = packet.issues.filter((i) => i.severity === 'error');
      expect(errors, `seed ${seed}`).toEqual([]);
      expect(packet.bytes.length).toBeGreaterThan(0);
    }
  });

  it('always produces exportable stacks (Ethernet or RAW linktype)', () => {
    for (let seed = 0; seed < 100; seed++) {
      const stack = randomStack(registry, { rng: mulberry32(seed) });
      expect(planExport(stack, registry).ok, `seed ${seed}`).toBe(true);
    }
  });

  it('respects maxDepth and never repeats a protocol more than twice', () => {
    for (let seed = 0; seed < 100; seed++) {
      const stack = randomStack(registry, { rng: mulberry32(seed), maxDepth: 5 });
      expect(stack.layers.length).toBeLessThanOrEqual(5);
      const counts = new Map<string, number>();
      for (const l of stack.layers)
        counts.set(l.protocolId, (counts.get(l.protocolId) ?? 0) + 1);
      for (const [id, n] of counts) expect(n, `seed ${seed}: ${id}`).toBeLessThanOrEqual(2);
    }
  });

  it('produces varied stacks across seeds', () => {
    const shapes = new Set(
      Array.from({ length: 100 }, (_, seed) =>
        randomStack(registry, { rng: mulberry32(seed) })
          .layers.map((l) => l.protocolId)
          .join('>'),
      ),
    );
    expect(shapes.size).toBeGreaterThan(20);
  });

  it('is deterministic for a given seed', () => {
    const a = randomStack(registry, { rng: mulberry32(7) });
    const b = randomStack(registry, { rng: mulberry32(7) });
    expect(a.layers.map((l) => l.protocolId)).toEqual(b.layers.map((l) => l.protocolId));
    expect([...(a.trailingPayload ?? [])]).toEqual([...(b.trailingPayload ?? [])]);
  });
});

describe('randomPayload', () => {
  it('honours an explicit length', () => {
    expect(randomPayload(0, mulberry32(1)).length).toBe(0);
    expect(randomPayload(1500, mulberry32(1)).length).toBe(1500);
  });

  it('defaults to 8–64 bytes', () => {
    for (let seed = 0; seed < 50; seed++) {
      const p = randomPayload(undefined, mulberry32(seed));
      expect(p.length).toBeGreaterThanOrEqual(8);
      expect(p.length).toBeLessThanOrEqual(64);
    }
  });

  it('produces byte values across the full range', () => {
    const p = randomPayload(4096, mulberry32(2));
    const distinct = new Set(p);
    expect(distinct.size).toBeGreaterThan(200);
  });
});
