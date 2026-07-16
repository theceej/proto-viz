/**
 * Random-but-valid stack and payload generation. Stacks are built by a
 * random walk over the binding graph, so every generated stack passes
 * validation by construction.
 */
import type { LayerInstance, StackInstance } from './model';
import { newLayer } from './model';
import type { Registry } from './registry';
import { getValidNextProtocols } from './validate';

export type Rng = () => number; // [0, 1)

/** Deterministic PRNG for reproducible generation (tests, shareable seeds). */
export function mulberry32(seed: number): Rng {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: Rng, items: T[]): T => items[Math.floor(rng() * items.length)]!;

export interface RandomStackOptions {
  rng?: Rng;
  /** Hard cap on layer count (tunnels can nest). */
  maxDepth?: number;
}

export function randomStack(registry: Registry, options: RandomStackOptions = {}): StackInstance {
  const rng = options.rng ?? Math.random;
  const maxDepth = options.maxDepth ?? 7;

  // Start at a link layer most of the time; sometimes raw IP (exports as RAW).
  const starts = registry.all().filter((p) => p.id === 'ethernet');
  const rawStarts = registry.all().filter((p) => p.id === 'ipv4' || p.id === 'ipv6');
  const layers: LayerInstance[] = [
    newLayer(rng() < 0.85 || starts.length === 0 ? (starts[0]?.id ?? 'ethernet') : pick(rng, rawStarts).id),
  ];

  const timesUsed = new Map<string, number>();
  timesUsed.set(layers[0]!.protocolId, 1);

  while (layers.length < maxDepth) {
    const lastDef = registry.get(layers[layers.length - 1]!.protocolId);
    // Stop once we reach an application-layer protocol.
    if (lastDef?.layerHint === 'application') break;

    const options_ = getValidNextProtocols({ layers }, registry)
      .filter((o) => o.allowed)
      // avoid degenerate loops: same protocol at most twice (Q-in-Q is fine)
      .filter((o) => (timesUsed.get(o.protocolId) ?? 0) < 2);
    if (options_.length === 0) break;

    // Occasionally stop early once the stack is already interesting.
    if (layers.length >= 3 && rng() < 0.25) break;

    const next = pick(rng, options_).protocolId;
    layers.push(newLayer(next));
    timesUsed.set(next, (timesUsed.get(next) ?? 0) + 1);
  }

  // Half the time, append a payload for the innermost layer to carry.
  const trailingPayload = rng() < 0.5 ? randomPayload(undefined, rng) : undefined;
  return { layers, trailingPayload };
}

/** Random payload bytes; length defaults to 8–64. */
export function randomPayload(length?: number, rng: Rng = Math.random): Uint8Array {
  const n = length ?? 8 + Math.floor(rng() * 57);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(rng() * 256);
  return out;
}
