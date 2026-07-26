/**
 * "Identify the packet": generated recall questions over a real packet.
 *
 * Every question here is *derived* from the protocol and field metadata the
 * rest of the app already runs on — never from a hand-written question bank.
 * That is the whole design constraint: a protocol imported from an RFC this
 * afternoon is eligible for questions this afternoon, with no curation step,
 * and a question can never drift out of sync with the definition it asks
 * about because it is generated from that definition every time.
 *
 * Three question kinds, all answerable from bytes a learner can see:
 *
 * - **protocol-at-span** — "whose header starts here?" Tests knowing what a
 *   protocol's opening bytes look like.
 * - **field-at-span** — "which field is this?" Tests header layout recall.
 * - **field-value** — "what does this field say?" Tests reading a value off
 *   the wire, and for enum fields, knowing what the number *means*.
 *
 * Distractors matter more than the questions. A wrong answer has to be
 * genuinely tempting or the exercise degenerates into elimination, so they
 * are drawn from the nearest neighbours the metadata offers: sibling fields
 * of the same header, other protocols at the same layer, other values from
 * the same enum table. Where no plausible neighbour exists the question is
 * skipped rather than padded with an obvious throwaway.
 */
import { newLayer, type FieldDef, type FieldValue, type ProtocolDefinition, type StackInstance } from './model';
import type { Registry } from './registry';
import { serializeStack, type SerializedPacket, type FieldSpan } from './serialize';
import { randomStack, type Rng } from './random';
import { PRESETS } from './presets';
import { formatHexBytes, formatIPv4, formatIPv6, formatMac, valueToNumber } from './values';

export type QuestionKind = 'protocol-at-span' | 'field-at-span' | 'field-value';

/** How many options a question offers, including the correct one. */
export const CHOICE_COUNT = 4;

export interface QuizChoice {
  id: string;
  label: string;
  correct: boolean;
}

/** A byte range of the packet, for highlighting in the quiz's hex view. */
export interface ByteRange {
  offset: number;
  length: number;
}

export interface QuizQuestion {
  id: string;
  kind: QuestionKind;
  prompt: string;
  choices: QuizChoice[];
  /** Bytes the question is about; highlighted while it is asked. */
  range: ByteRange;
  /** What the learner should take away, revealed with the answer. */
  explanation: string;
  /** The protocol the question is about: names it, and links to its spec. */
  protocolId: string;
  protocolName: string;
  /** Where to point the inspector when reviewing this question. */
  focus: { layerUid: string; fieldId?: string };
}

/** Fisher-Yates, so choice order carries no information about the answer. */
function shuffle<T>(rng: Rng, items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Take up to `n` distinct items, in random order. */
function sample<T>(rng: Rng, items: T[], n: number): T[] {
  return shuffle(rng, items).slice(0, n);
}

/**
 * The byte range a field's bits touch. Sub-byte fields (a 3-bit flags group,
 * a 4-bit IHL) still highlight the whole byte they live in — the hex view has
 * no finer unit to offer.
 */
const bitsToBytes = (span: FieldSpan): ByteRange => ({
  offset: Math.floor(span.bitOffset / 8),
  length: Math.max(1, Math.ceil(((span.bitOffset % 8) + span.bitLength) / 8)),
});

/**
 * Render a value the way a quiz option should read: plainly, and *without*
 * the enum label `formatFieldValue` appends — an option reading "6 — TCP"
 * would answer an enum question for the learner.
 */
export function describeValue(field: FieldDef, value: FieldValue): string {
  switch (field.type) {
    case 'mac':
      return value instanceof Uint8Array ? formatMac(value) : String(value);
    case 'ipv4':
      return value instanceof Uint8Array ? formatIPv4(value) : String(value);
    case 'ipv6':
      return value instanceof Uint8Array ? formatIPv6(value) : String(value);
    case 'bytes':
      if (!(value instanceof Uint8Array)) return String(value);
      return value.length === 0
        ? '(empty)'
        : formatHexBytes(value.subarray(0, 8)) + (value.length > 8 ? ' …' : '');
    case 'string':
    case 'dnsName':
      return truncate(String(value), 40);
    case 'flags':
    case 'uint': {
      const n = safeNumber(field, value);
      if (n === null) return String(value);
      return typeof field.bitLength === 'number' && field.bitLength >= 16
        ? `${n} (0x${n.toString(16)})`
        : String(n);
    }
  }
}

function safeNumber(field: FieldDef, value: FieldValue): number | null {
  try {
    return valueToNumber(field, value);
  } catch {
    return null;
  }
}

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

interface ResolvedLayer {
  uid: string;
  def: ProtocolDefinition;
  byteOffset: number;
  headerBytes: number;
}

/** Layers of the packet paired with their definition, skipping unknown ids. */
function resolveLayers(packet: SerializedPacket, registry: Registry): ResolvedLayer[] {
  return packet.layers.flatMap((layout) => {
    const def = registry.get(layout.protocolId);
    return def && layout.headerBytes > 0
      ? [{ uid: layout.uid, def, byteOffset: layout.byteOffset, headerBytes: layout.headerBytes }]
      : [];
  });
}

/**
 * Protocols that could plausibly be confused with `def`, best first:
 *
 * 1. Same layer hint — "is this TCP or UDP?" rather than "TCP or Ethernet?".
 * 2. Something that claims a namespace `def` also claims, i.e. a protocol
 *    that could legally have occupied this exact position in the stack. For
 *    a transport header that is every other IP protocol number, which is a
 *    far better distractor than an unrelated protocol from the same tier.
 * 3. Anything else, only to fill a slot that would otherwise go empty.
 *
 * Tier 1 alone is often too small — the library has only a handful of
 * transport protocols — so the tiers are drawn in order rather than as a
 * single pool.
 */
function protocolDistractors(
  def: ProtocolDefinition,
  registry: Registry,
  rng: Rng,
  n: number,
): ProtocolDefinition[] {
  const namespaces = new Set(def.encapsulations.map((claim) => claim.namespaceId));
  const others = registry.all().filter((p) => p.id !== def.id);
  const tiers = [
    others.filter((p) => p.layerHint === def.layerHint),
    others.filter((p) => p.encapsulations.some((claim) => namespaces.has(claim.namespaceId))),
    others,
  ];

  const chosen: ProtocolDefinition[] = [];
  for (const tier of tiers) {
    if (chosen.length >= n) break;
    const fresh = tier.filter((p) => !chosen.includes(p));
    chosen.push(...sample(rng, fresh, n - chosen.length));
  }
  return chosen;
}

/** "Whose header starts at this offset?" */
function protocolAtSpan(
  layer: ResolvedLayer,
  registry: Registry,
  rng: Rng,
): QuizQuestion | null {
  const distractors = protocolDistractors(layer.def, registry, rng, CHOICE_COUNT - 1);
  if (distractors.length < CHOICE_COUNT - 1) return null;

  const choices = shuffle(rng, [
    { id: layer.def.id, label: layer.def.name, correct: true },
    ...distractors.map((p) => ({ id: p.id, label: p.name, correct: false })),
  ]);

  return {
    id: `protocol:${layer.uid}`,
    kind: 'protocol-at-span',
    prompt: `The highlighted ${layer.headerBytes} bytes are a protocol header. Which protocol?`,
    choices,
    range: { offset: layer.byteOffset, length: layer.headerBytes },
    explanation: `${layer.def.name}${layer.def.fullName ? ` (${layer.def.fullName})` : ''} — a ${layer.def.layerHint}-layer protocol with a ${layer.headerBytes}-byte header here.`,
    protocolId: layer.def.id,
    protocolName: layer.def.name,
    focus: { layerUid: layer.uid },
  };
}

/** "Which field of this header are the highlighted bytes?" */
function fieldAtSpan(
  layer: ResolvedLayer,
  span: FieldSpan,
  present: FieldDef[],
  rng: Rng,
): QuizQuestion | null {
  const field = present.find((f) => f.id === span.fieldId);
  if (!field) return null;
  // Siblings of the same header are the only honest distractors — a field
  // from another protocol would be ruled out by the prompt alone.
  const siblings = present.filter((f) => f.id !== field.id);
  if (siblings.length < CHOICE_COUNT - 1) return null;

  const choices = shuffle(rng, [
    { id: field.id, label: field.name, correct: true },
    ...sample(rng, siblings, CHOICE_COUNT - 1).map((f) => ({
      id: f.id,
      label: f.name,
      correct: false,
    })),
  ]);

  const bits = span.bitLength;
  return {
    id: `field:${layer.uid}:${field.id}`,
    kind: 'field-at-span',
    prompt: `The highlighted bits are a field of the ${layer.def.name} header. Which field?`,
    choices,
    range: bitsToBytes(span),
    explanation:
      `${field.name} occupies ${bits} bit${bits === 1 ? '' : 's'} here.` +
      (field.description ? ` ${field.description}` : ''),
    protocolId: layer.def.id,
    protocolName: layer.def.name,
    focus: { layerUid: layer.uid, fieldId: field.id },
  };
}

/**
 * "What does this field say?" For a field with an enum table the question
 * becomes a meaning question — the number is given and the options are what
 * it could stand for, which is the more useful thing to know.
 */
function fieldValue(
  layer: ResolvedLayer,
  span: FieldSpan,
  field: FieldDef,
  present: FieldDef[],
  registry: Registry,
  rng: Rng,
): QuizQuestion | null {
  const table = field.enumRef ? registry.getEnum(field.enumRef) : undefined;
  const range = bitsToBytes(span);
  const common = {
    range,
    protocolId: layer.def.id,
    protocolName: layer.def.name,
    focus: { layerUid: layer.uid, fieldId: field.id },
  };

  if (table) {
    const value = safeNumber(field, span.value);
    const label = value === null ? undefined : table.values[value];
    if (value === null || label === undefined) return null;
    const others = Object.entries(table.values).filter(([, name]) => name !== label);
    if (others.length < CHOICE_COUNT - 1) return null;

    const choices = shuffle(rng, [
      { id: label, label, correct: true },
      ...sample(rng, others, CHOICE_COUNT - 1).map(([key, name]) => ({
        id: key,
        label: name,
        correct: false,
      })),
    ]);
    return {
      ...common,
      id: `meaning:${layer.uid}:${field.id}`,
      kind: 'field-value',
      prompt: `${layer.def.name}'s ${field.name} field is ${describeValue(field, span.value)}. What does that select?`,
      choices,
      explanation: `${table.name}: ${value} means ${label}.`,
    };
  }

  const correct = describeValue(field, span.value);
  const distractors = valueDistractors(field, span.value, present, rng)
    .filter((v) => v !== correct)
    .filter((v, i, all) => all.indexOf(v) === i)
    .slice(0, CHOICE_COUNT - 1);
  if (distractors.length < CHOICE_COUNT - 1) return null;

  const choices = shuffle(rng, [
    { id: 'correct', label: correct, correct: true },
    ...distractors.map((label, i) => ({ id: `wrong-${i}`, label, correct: false })),
  ]);
  return {
    ...common,
    id: `value:${layer.uid}:${field.id}`,
    kind: 'field-value',
    prompt: `What is the value of ${layer.def.name}'s ${field.name} field?`,
    choices,
    explanation:
      `${field.name} reads ${correct} in these bytes.` +
      (field.description ? ` ${field.description}` : ''),
  };
}

/**
 * Wrong values that could be read off the same bytes by a plausible mistake:
 * an off-by-one, a byte-order slip, a doubled or halved figure. Address and
 * text fields borrow from sibling fields of the same header instead, since
 * arithmetic on them produces nonsense nobody would pick.
 */
function valueDistractors(
  field: FieldDef,
  value: FieldValue,
  present: FieldDef[],
  rng: Rng,
): string[] {
  if (field.type === 'uint' || field.type === 'flags') {
    const n = safeNumber(field, value);
    if (n === null) return [];
    const width = typeof field.bitLength === 'number' ? field.bitLength : 16;
    const max = width >= 32 ? 0xffffffff : (1 << width) - 1;
    const clamp = (x: number) => Math.max(0, Math.min(max, Math.round(x)));
    const swapped = width === 16 ? ((n & 0xff) << 8) | ((n >> 8) & 0xff) : n;
    return shuffle(rng, [n + 1, n - 1, n * 2, Math.floor(n / 2), swapped, n + 16])
      .map(clamp)
      .filter((x) => x !== n)
      .map((x) => describeValue(field, x));
  }

  // Same-typed neighbours: the other MAC in an Ethernet header, the other
  // address in an IP header — exactly the confusion worth testing.
  const siblings = present.filter((f) => f.id !== field.id && f.type === field.type);
  const fromSiblings = siblings
    .map((f) => (f.default !== undefined ? describeValue(f, f.default) : null))
    .filter((v): v is string => v !== null);
  return shuffle(rng, fromSiblings);
}

export interface GenerateOptions {
  rng?: Rng;
  /** How many questions to try to produce. */
  count?: number;
}

/**
 * Build a question set for one packet. Fewer than `count` questions come back
 * when the packet cannot support more — a two-field header offers no honest
 * field-identification question, and padding it out would teach nothing.
 */
export function generateQuestions(
  packet: SerializedPacket,
  registry: Registry,
  options: GenerateOptions = {},
): QuizQuestion[] {
  const rng = options.rng ?? Math.random;
  const count = options.count ?? 5;
  const layers = resolveLayers(packet, registry);
  if (layers.length === 0) return [];

  const candidates: QuizQuestion[] = [];

  for (const layer of layers) {
    const spans = packet.spans.filter((s) => s.layerUid === layer.uid && s.bitLength > 0);
    const present = spans.flatMap((s) => {
      const field = layer.def.fields.find((f) => f.id === s.fieldId);
      return field ? [field] : [];
    });

    const protocolQuestion = protocolAtSpan(layer, registry, rng);
    if (protocolQuestion) candidates.push(protocolQuestion);

    for (const span of spans) {
      const field = present.find((f) => f.id === span.fieldId);
      if (!field) continue;
      const identify = fieldAtSpan(layer, span, present, rng);
      if (identify) candidates.push(identify);
      const value = fieldValue(layer, span, field, present, registry, rng);
      if (value) candidates.push(value);
    }
  }

  // Spread the selection across kinds so a set is not five value questions,
  // then shuffle so the order does not telegraph the packet's structure.
  return shuffle(rng, roundRobinByKind(shuffle(rng, candidates)).slice(0, count));
}

/** Interleave questions by kind, preserving the (already random) order within each. */
function roundRobinByKind(questions: QuizQuestion[]): QuizQuestion[] {
  const buckets = new Map<QuestionKind, QuizQuestion[]>();
  for (const question of questions) {
    const bucket = buckets.get(question.kind);
    if (bucket) bucket.push(question);
    else buckets.set(question.kind, [question]);
  }
  const out: QuizQuestion[] = [];
  const lists = [...buckets.values()];
  for (let i = 0; out.length < questions.length; i++) {
    for (const list of lists) {
      const next = list[i];
      if (next) out.push(next);
    }
    if (lists.every((list) => i >= list.length)) break;
  }
  return out;
}

export type QuizSource = 'random' | 'curated';

export interface QuizRound {
  /** The stack the questions are about — handed to the builder on review. */
  stack: StackInstance;
  packet: SerializedPacket;
  questions: QuizQuestion[];
  /** Named only in the reveal; showing it up front would answer the questions. */
  sourceLabel: string;
}

/** How many packets to try before giving up on producing a usable round. */
const ROUND_ATTEMPTS = 12;

/**
 * Draw a packet and build a round from it.
 *
 * Random stacks are the interesting source — they reach corners of the
 * library a curated list never would — but a random walk can land on a stack
 * that serializes to almost nothing, or whose headers are too small to ask an
 * honest question about. Rather than lower the bar for questions, this simply
 * draws again, and returns null only if the library cannot support a round at
 * all.
 */
export function generateRound(
  registry: Registry,
  source: QuizSource,
  options: GenerateOptions & { minQuestions?: number } = {},
): QuizRound | null {
  const rng = options.rng ?? Math.random;
  const count = options.count ?? 5;
  const minQuestions = options.minQuestions ?? 3;

  for (let attempt = 0; attempt < ROUND_ATTEMPTS; attempt++) {
    const drawn = source === 'curated' ? drawPreset(rng) : drawRandom(registry, rng);
    if (!drawn) continue;
    let packet: SerializedPacket;
    try {
      packet = serializeStack(drawn.stack, registry);
    } catch {
      continue;
    }
    const questions = generateQuestions(packet, registry, { rng, count });
    // The last attempt takes whatever it can get; anything is better than an
    // empty screen when the registry is unusually small (a custom-only build).
    const enough = attempt === ROUND_ATTEMPTS - 1 ? questions.length > 0 : questions.length >= minQuestions;
    if (enough) {
      return { stack: drawn.stack, packet, questions, sourceLabel: drawn.label };
    }
  }
  return null;
}

function drawRandom(registry: Registry, rng: Rng): { stack: StackInstance; label: string } | null {
  const stack = randomStack(registry, { rng });
  return stack.layers.length === 0 ? null : { stack, label: 'Randomly generated stack' };
}

function drawPreset(rng: Rng): { stack: StackInstance; label: string } | null {
  const preset = PRESETS[Math.floor(rng() * PRESETS.length)];
  if (!preset) return null;
  return {
    stack: {
      layers: preset.layers.map((layer) => ({
        ...newLayer(layer.protocolId),
        overrides: { ...layer.overrides },
        pinned: [...(layer.pinned ?? [])],
      })),
      ...(preset.payload ? { trailingPayload: preset.payload } : {}),
    },
    label: `Preset: ${preset.name}`,
  };
}

export interface Score {
  asked: number;
  correct: number;
  streak: number;
  bestStreak: number;
}

export const EMPTY_SCORE: Score = { asked: 0, correct: 0, streak: 0, bestStreak: 0 };

/** Fold one answer into the running score. Pure, so the UI never mutates it. */
export function scoreAnswer(score: Score, wasCorrect: boolean): Score {
  const streak = wasCorrect ? score.streak + 1 : 0;
  return {
    asked: score.asked + 1,
    correct: score.correct + (wasCorrect ? 1 : 0),
    streak,
    bestStreak: Math.max(score.bestStreak, streak),
  };
}

/** Whole-number percentage; zero questions reads as 0 rather than NaN. */
export function accuracy(score: Score): number {
  return score.asked === 0 ? 0 : Math.round((score.correct / score.asked) * 100);
}
