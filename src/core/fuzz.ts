/**
 * Packet fuzzing: reproducible, scoped corruption of a serialized packet.
 *
 * `experiments.ts` covers the curated case — eight named mutations that each
 * pin one computed field to a known-wrong value, chosen to teach a specific
 * diagnostic. This is the open-ended counterpart: pick a scope, a strategy,
 * and a seed, and find out what breaks.
 *
 * Two properties matter more than the mutations themselves.
 *
 * **Reproducibility.** Everything is driven by `mulberry32`, so a seed names a
 * result. A learner can share "seed 4242 on this stack" and a colleague sees
 * the identical corrupted packet; a test can assert on exact bytes.
 *
 * **Staying in the model.** Length-preserving mutations are folded back into
 * the stack through `applyByteEdits`, the same path the hex editor uses, so
 * the result is an ordinary `StackInstance`: it renders in the normal field,
 * diagram, and hex views, exports as a PCAP, and shares as an exact-packet
 * link, with no special-casing anywhere downstream. Truncation and extension
 * cannot fold back — the packet is no longer the length its headers describe,
 * which is exactly what makes them interesting — so those results carry bytes
 * only, and the caller renders them as raw hex.
 *
 * Nothing here transmits anything. A fuzzed packet is a local artefact, the
 * same as every other packet the app builds.
 */
import { applyByteEdits } from './editByte';
import type { StackInstance } from './model';
import { mulberry32, type Rng } from './random';
import type { Registry } from './registry';
import { serializeStack, type FieldSpan, type SerializedPacket } from './serialize';

export const MUTATIONS = [
  'bit-flip',
  'zero',
  'boundary',
  'length-overflow',
  'truncate',
  'extend',
] as const;
export type MutationStrategy = (typeof MUTATIONS)[number];

/** Strategies that change how many bytes the packet has. Gated behind a flag. */
export const LENGTH_CHANGING: readonly MutationStrategy[] = ['truncate', 'extend'];

export const isLengthChanging = (strategy: MutationStrategy): boolean =>
  LENGTH_CHANGING.includes(strategy);

/**
 * Values worth trying at a byte boundary: all-zero, all-ones, and the two
 * sides of the signed-byte boundary, which is where sign-extension and
 * off-by-one bugs in a parser tend to show themselves.
 */
const BOUNDARY_VALUES = [0x00, 0xff, 0x7f, 0x80, 0x01, 0xfe];

export interface FuzzTarget {
  /** Layer uids to confine mutations to. Empty means the whole packet. */
  layerUids: string[];
  /** Optional explicit byte range, intersected with the layer scope. */
  byteRange?: { start: number; end: number };
}

export interface Mutation {
  /** Absolute position of what changed, for highlighting in the packet views. */
  bitOffset: number;
  bitLength: number;
  /** Human-readable account of the change, shown in the mutation list. */
  description: string;
}

export interface FuzzOptions {
  seed: number;
  strategy: MutationStrategy;
  /** How many individual mutations to attempt. */
  count: number;
  target: FuzzTarget;
  /** Required for `truncate` and `extend`; they are refused without it. */
  allowLengthChange?: boolean;
}

export interface FuzzResult {
  /** The mutated wire bytes — always present, and the source of truth. */
  bytes: Uint8Array;
  mutations: Mutation[];
  /** The mutated packet as a stack, when the result still folds back into one. */
  stack: StackInstance | null;
  /** Why `stack` is null, when it is. */
  foldbackNote?: string;
  lengthChanged: boolean;
}

export class FuzzError extends Error {}

/** Byte offsets the target selects, in ascending order. */
export function resolveTarget(packet: SerializedPacket, target: FuzzTarget): number[] {
  const inLayers = (offset: number): boolean => {
    if (target.layerUids.length === 0) return true;
    return packet.layers.some(
      (layout) =>
        target.layerUids.includes(layout.uid) &&
        offset >= layout.byteOffset &&
        offset < layout.byteOffset + layout.headerBytes,
    );
  };
  const start = Math.max(0, target.byteRange?.start ?? 0);
  const end = Math.min(packet.bytes.length - 1, target.byteRange?.end ?? packet.bytes.length - 1);

  const offsets: number[] = [];
  for (let offset = start; offset <= end; offset++) {
    if (inLayers(offset)) offsets.push(offset);
  }
  return offsets;
}

/** Spans of length-ish fields inside the scope, best candidates first. */
function lengthSpans(packet: SerializedPacket, scope: Set<number>): FieldSpan[] {
  return packet.spans.filter((span) => {
    if (span.bitLength === 0 || span.bitLength > 32) return false;
    const first = Math.floor(span.bitOffset / 8);
    const last = Math.floor((span.bitOffset + span.bitLength - 1) / 8);
    for (let offset = first; offset <= last; offset++) if (!scope.has(offset)) return false;
    // A computed field whose value is derived arithmetically is a length,
    // an offset, or a count — exactly what overflowing is interesting for.
    return span.computed && /len|size|count|offset|ihl/i.test(span.fieldId);
  });
}

/** Read the bits of `span` out of `bytes` as a number. */
const spanBytes = (span: FieldSpan): { first: number; last: number } => ({
  first: Math.floor(span.bitOffset / 8),
  last: Math.floor((span.bitOffset + span.bitLength - 1) / 8),
});

/**
 * Corrupt a packet. Throws `FuzzError` for a request that cannot be honoured
 * — a length-changing strategy without the flag, or a scope with no bytes in
 * it — rather than silently returning the packet unchanged, which would read
 * as "the mutation did nothing" and teach the wrong lesson.
 */
export function fuzzPacket(
  stack: StackInstance,
  packet: SerializedPacket,
  registry: Registry,
  options: FuzzOptions,
): FuzzResult {
  const { seed, strategy, count, target } = options;
  if (isLengthChanging(strategy) && !options.allowLengthChange) {
    throw new FuzzError(
      `${strategy} changes the packet's length; enable length-changing mutations first.`,
    );
  }
  if (count < 1) throw new FuzzError('Ask for at least one mutation.');

  const rng = mulberry32(seed);
  const offsets = resolveTarget(packet, target);
  if (offsets.length === 0) {
    throw new FuzzError('The selected target covers no bytes of this packet.');
  }

  if (strategy === 'truncate') return truncate(packet, offsets, rng);
  if (strategy === 'extend') return extend(packet, rng, count);

  const edits = new Map<number, number>();
  const mutations: Mutation[] = [];
  const bytes = new Uint8Array(packet.bytes);
  // Length fields already driven to their maximum, so a second pick moves to
  // a different field instead of re-applying a no-op.
  const spent = new Set<FieldSpan>();

  for (let i = 0; i < count; i++) {
    // A pick can land on a byte that already holds the value the strategy
    // wants (zeroing an existing zero). That is not a reason to abandon the
    // run, so try a few times before accepting there is nothing left to do.
    let applied: AppliedMutation | null = null;
    for (let attempt = 0; attempt < 8 && !applied; attempt++) {
      applied =
        strategy === 'length-overflow'
          ? overflowLength(packet, offsets, bytes, rng, spent)
          : mutateByte(strategy, offsets, bytes, rng);
    }
    if (!applied) break;
    for (const [offset, value] of applied.edits) {
      bytes[offset] = value;
      edits.set(offset, value);
    }
    mutations.push(applied.mutation);
  }

  if (mutations.length === 0) {
    throw new FuzzError('No mutation could be applied within the selected target.');
  }

  const folded = applyByteEdits(stack, packet, registry, edits);
  if (!folded) {
    return {
      bytes,
      mutations,
      stack: null,
      foldbackNote:
        'The mutated bytes do not map onto any field or payload byte, so they are shown as raw bytes only.',
      lengthChanged: false,
    };
  }

  const reconciled = reconcile(
    { layers: folded.layers, trailingPayload: folded.trailingPayload },
    bytes,
    registry,
  );
  return {
    bytes,
    mutations,
    stack: reconciled.stack,
    ...(reconciled.note !== undefined ? { foldbackNote: reconciled.note } : {}),
    lengthChanged: false,
  };
}

/**
 * Make the folded-back stack reproduce the mutated bytes exactly.
 *
 * Corrupting a byte leaves every *computed* field that covers it stale: the
 * mutated wire bytes still carry the old checksum, while re-serializing the
 * stack recalculates a correct one for the new contents. That difference
 * matters — an exported PCAP has to be the packet on screen, and a packet
 * whose checksum silently repaired itself is not a fuzzed packet at all.
 *
 * So any computed field that disagrees is pinned to the mutated value, which
 * is exactly what the hex decoder does for pasted bytes (`reconcile` in
 * decodeStack.ts). Pinning can shift another computed field, so this iterates
 * until the bytes agree or nothing more changes.
 */
function reconcile(
  stack: StackInstance,
  target: Uint8Array,
  registry: Registry,
): { stack: StackInstance; note?: string } {
  let current = stack;
  for (let pass = 0; pass < 4; pass++) {
    let rebuilt: SerializedPacket;
    try {
      rebuilt = serializeStack(current, registry);
    } catch {
      return {
        stack: current,
        note: 'The mutated stack no longer serializes, so the bytes shown are the only faithful form.',
      };
    }
    if (rebuilt.bytes.length !== target.length) {
      return {
        stack: current,
        note: `Re-encoding the mutated stack produces ${rebuilt.bytes.length} bytes rather than ${target.length}; the raw bytes are authoritative.`,
      };
    }

    const delta = new Map<number, number>();
    for (let i = 0; i < target.length; i++) {
      if (rebuilt.bytes[i] !== target[i]) delta.set(i, target[i]!);
    }
    if (delta.size === 0) return { stack: current };

    const next = applyByteEdits(current, rebuilt, registry, delta);
    if (!next) break;
    current = { layers: next.layers, trailingPayload: next.trailingPayload };
  }

  return {
    stack: current,
    note: 'Some mutated bytes could not be preserved through re-encoding; the raw bytes are authoritative.',
  };
}

interface AppliedMutation {
  edits: [number, number][];
  mutation: Mutation;
}

/** One in-place byte mutation for the flip / zero / boundary strategies. */
function mutateByte(
  strategy: Exclude<MutationStrategy, 'length-overflow' | 'truncate' | 'extend'>,
  offsets: number[],
  bytes: Uint8Array,
  rng: Rng,
): AppliedMutation | null {
  const offset = offsets[Math.floor(rng() * offsets.length)]!;
  const current = bytes[offset]!;

  if (strategy === 'bit-flip') {
    const bit = Math.floor(rng() * 8); // 0 = most significant
    const value = current ^ (0x80 >> bit);
    return {
      edits: [[offset, value]],
      mutation: {
        bitOffset: offset * 8 + bit,
        bitLength: 1,
        description: `Flipped bit ${bit} of byte ${offset}: 0x${hex(current)} → 0x${hex(value)}`,
      },
    };
  }

  const value =
    strategy === 'zero' ? 0 : BOUNDARY_VALUES[Math.floor(rng() * BOUNDARY_VALUES.length)]!;
  if (value === current) return null;
  return {
    edits: [[offset, value]],
    mutation: {
      bitOffset: offset * 8,
      bitLength: 8,
      description:
        strategy === 'zero'
          ? `Zeroed byte ${offset} (was 0x${hex(current)})`
          : `Set byte ${offset} to boundary value 0x${hex(value)} (was 0x${hex(current)})`,
    },
  };
}

/** Drive a length/offset/count field to its maximum. */
function overflowLength(
  packet: SerializedPacket,
  offsets: number[],
  bytes: Uint8Array,
  rng: Rng,
  spent: Set<FieldSpan>,
): AppliedMutation | null {
  const scope = new Set(offsets);
  // Already-maxed fields are excluded by identity rather than by inspecting
  // the bytes: a sub-byte field at its maximum still leaves its byte below
  // 0xff, so a byte check would keep re-picking it.
  const candidates = lengthSpans(packet, scope).filter((span) => !spent.has(span));
  if (candidates.length === 0) return null;

  const span = candidates[Math.floor(rng() * candidates.length)]!;
  spent.add(span);
  const { first, last } = spanBytes(span);
  // Whole-byte fields set every byte to 0xff. A sub-byte field (IPv4's IHL,
  // say) would corrupt its neighbour that way, so only its own bits are set.
  const wholeBytes = span.bitOffset % 8 === 0 && span.bitLength % 8 === 0;
  const edits: [number, number][] = [];
  if (wholeBytes) {
    for (let offset = first; offset <= last; offset++) edits.push([offset, 0xff]);
  } else {
    for (let offset = first; offset <= last; offset++) {
      let value = bytes[offset]!;
      for (let bit = 0; bit < 8; bit++) {
        const absolute = offset * 8 + bit;
        if (absolute >= span.bitOffset && absolute < span.bitOffset + span.bitLength) {
          value |= 0x80 >> bit;
        }
      }
      edits.push([offset, value]);
    }
  }

  return {
    edits,
    mutation: {
      bitOffset: span.bitOffset,
      bitLength: span.bitLength,
      description: `Drove ${span.fieldId} to its maximum (${span.bitLength} bits all set), overstating the length it reports`,
    },
  };
}

/** Cut the packet short at a byte inside the target scope. */
function truncate(packet: SerializedPacket, offsets: number[], rng: Rng): FuzzResult {
  // Keep at least one byte, and always remove at least one.
  const usable = offsets.filter((offset) => offset > 0);
  if (usable.length === 0) {
    throw new FuzzError('There is nothing to truncate within the selected target.');
  }
  const cut = usable[Math.floor(rng() * usable.length)]!;
  const removed = packet.bytes.length - cut;
  return {
    bytes: packet.bytes.slice(0, cut),
    mutations: [
      {
        bitOffset: cut * 8,
        bitLength: removed * 8,
        description: `Truncated after byte ${cut}, removing the last ${removed} bytes`,
      },
    ],
    stack: null,
    foldbackNote:
      'A truncated packet is shorter than its own headers claim, so it no longer maps onto a stack. It is shown as raw bytes and can still be exported as a PCAP.',
    lengthChanged: true,
  };
}

/** Append trailing garbage the headers do not account for. */
function extend(packet: SerializedPacket, rng: Rng, count: number): FuzzResult {
  const added = Math.max(1, Math.min(64, count));
  const bytes = new Uint8Array(packet.bytes.length + added);
  bytes.set(packet.bytes);
  for (let i = 0; i < added; i++) bytes[packet.bytes.length + i] = Math.floor(rng() * 256);
  return {
    bytes,
    mutations: [
      {
        bitOffset: packet.bytes.length * 8,
        bitLength: added * 8,
        description: `Appended ${added} bytes of trailing data the headers do not account for`,
      },
    ],
    stack: null,
    foldbackNote:
      'The appended bytes sit beyond everything the headers describe, so the result is shown as raw bytes and can still be exported as a PCAP.',
    lengthChanged: true,
  };
}

const hex = (value: number) => value.toString(16).padStart(2, '0');
