import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../protocols';
import { createRegistry } from './registry';
import { mulberry32 } from './random';
import { newLayer, type ProtocolDefinition, type StackInstance } from './model';
import { serializeStack } from './serialize';
import {
  accuracy,
  CHOICE_COUNT,
  describeValue,
  EMPTY_SCORE,
  generateQuestions,
  generateRound,
  scoreAnswer,
  type QuizQuestion,
} from './quiz';

const registry = createBuiltinRegistry();

const stackOf = (ids: string[]): StackInstance => ({ layers: ids.map(newLayer) });
const packetOf = (ids: string[]) => serializeStack(stackOf(ids), registry);

/** Questions for a fixed stack and seed — deterministic, so assertions bite. */
const questionsFor = (ids: string[], seed = 1, count = 40): QuizQuestion[] =>
  generateQuestions(packetOf(ids), registry, { rng: mulberry32(seed), count });

describe('generateQuestions', () => {
  const tcp = questionsFor(['ethernet', 'ipv4', 'tcp']);

  it('produces questions of every supported kind for an ordinary stack', () => {
    const kinds = new Set(questionsFor(['ethernet', 'ipv4', 'tcp'], 1, 200).map((q) => q.kind));
    expect(kinds).toContain('protocol-at-span');
    expect(kinds).toContain('field-at-span');
    expect(kinds).toContain('field-value');
  });

  it('gives every question exactly one correct answer among four', () => {
    expect(tcp.length).toBeGreaterThan(0);
    for (const question of tcp) {
      expect(question.choices, question.prompt).toHaveLength(CHOICE_COUNT);
      expect(question.choices.filter((c) => c.correct), question.prompt).toHaveLength(1);
    }
  });

  it('never repeats an option within a question', () => {
    for (const question of questionsFor(['ethernet', 'ipv4', 'udp', 'dns'], 3, 200)) {
      const labels = question.choices.map((c) => c.label);
      expect(new Set(labels).size, question.prompt).toBe(labels.length);
    }
  });

  it('points every question at bytes that exist in the packet', () => {
    const packet = packetOf(['ethernet', 'ipv6', 'tcp']);
    for (const question of generateQuestions(packet, registry, {
      rng: mulberry32(5),
      count: 200,
    })) {
      expect(question.range.length, question.prompt).toBeGreaterThan(0);
      expect(question.range.offset + question.range.length).toBeLessThanOrEqual(
        packet.bytes.length,
      );
    }
  });

  it('is deterministic for a given seed', () => {
    // Layer uids differ between runs (they carry a global counter), so
    // compare what a learner actually sees rather than internal ids.
    const shown = (questions: QuizQuestion[]) =>
      questions.map((q) => [q.kind, q.prompt, q.range, q.choices.map((c) => c.label)]);
    expect(shown(questionsFor(['ethernet', 'ipv4', 'tcp'], 99))).toEqual(
      shown(questionsFor(['ethernet', 'ipv4', 'tcp'], 99)),
    );
  });

  it('caps the set at the requested count', () => {
    expect(questionsFor(['ethernet', 'ipv4', 'tcp'], 1, 3)).toHaveLength(3);
  });

  it('returns nothing for a packet with no layers', () => {
    expect(generateQuestions(serializeStack({ layers: [] }, registry), registry)).toEqual([]);
  });

  describe('protocol questions', () => {
    const question = questionsFor(['ethernet', 'ipv4', 'tcp'], 1, 200).find(
      (q) => q.kind === 'protocol-at-span' && q.protocolId === 'tcp',
    )!;

    it('highlights exactly the protocol header it asks about', () => {
      const packet = packetOf(['ethernet', 'ipv4', 'tcp']);
      const layer = packet.layers.find((l) => l.protocolId === 'tcp')!;
      expect(question.range).toEqual({
        offset: layer.byteOffset,
        length: layer.headerBytes,
      });
    });

    it('offers distractors that could have occupied the same position', () => {
      // The library has only two other transport protocols, so the third
      // distractor comes from the next tier: something else claiming an IP
      // protocol number, which is still a packet that could have been here.
      const ipProtocolClaimants = new Set(
        registry
          .all()
          .filter((p) => p.encapsulations.some((c) => c.namespaceId === 'ip-proto'))
          .map((p) => p.name),
      );
      for (const choice of question.choices.filter((c) => !c.correct)) {
        const def = registry.all().find((p) => p.name === choice.label)!;
        expect(
          def.layerHint === 'transport' || ipProtocolClaimants.has(choice.label),
          choice.label,
        ).toBe(true);
      }
    });

    it('carries the protocol identity for the library link', () => {
      expect(question.protocolId).toBe('tcp');
      expect(question.protocolName).toBe('TCP');
      expect(question.focus.layerUid).toBeTruthy();
    });
  });

  describe('field-identification questions', () => {
    const question = questionsFor(['ethernet', 'ipv4', 'tcp'], 2, 200).find(
      (q) => q.kind === 'field-at-span' && q.protocolId === 'ipv4',
    )!;

    it('names the protocol in the prompt, since the bytes alone would be ambiguous', () => {
      expect(question.prompt).toContain('IPv4');
    });

    it('draws every distractor from the same header', () => {
      const ipv4 = registry.get('ipv4')!;
      const names = new Set(ipv4.fields.map((f) => f.name));
      for (const choice of question.choices) {
        expect(names.has(choice.label), choice.label).toBe(true);
      }
    });
  });

  describe('value questions', () => {
    const all = questionsFor(['ethernet', 'ipv4', 'tcp'], 4, 300);

    it('asks what an enum value means, with other labels from the same table', () => {
      const question = all.find((q) => q.id === 'meaning:' + q.focus.layerUid + ':protocol')!;
      expect(question.prompt).toMatch(/What does that select\?/);
      const ipProto = registry.getEnum('ip-proto')!;
      const labels = new Set(Object.values(ipProto.values));
      for (const choice of question.choices) {
        expect(labels.has(choice.label), choice.label).toBe(true);
      }
      expect(question.choices.find((c) => c.correct)!.label).toBe('TCP');
    });

    it('never prints the enum label in the prompt, which would give it away', () => {
      const question = all.find((q) => q.id.startsWith('meaning:'))!;
      const answer = question.choices.find((c) => c.correct)!.label;
      expect(question.prompt).not.toContain(answer);
    });

    it('offers near-miss numbers for a plain numeric field', () => {
      const question = all.find((q) => q.id.startsWith('value:') && q.id.endsWith(':ttl'))!;
      expect(question.prompt).toContain('TTL');
      expect(question.choices.find((c) => c.correct)!.label).toBe('64');
      // Wrong answers are numbers a careless read could produce, not noise.
      for (const choice of question.choices.filter((c) => !c.correct)) {
        expect(Number(choice.label), choice.label).not.toBeNaN();
      }
    });
  });

  it('skips questions a header cannot support honestly', () => {
    // A protocol with two fields cannot offer three sibling distractors, so
    // no field-identification question should be generated for it.
    const tiny: ProtocolDefinition = {
      id: 'tiny',
      name: 'Tiny',
      layerHint: 'application',
      source: 'builtin',
      fields: [
        { id: 'a', name: 'A', type: 'uint', bitLength: 8, default: 1 },
        { id: 'b', name: 'B', type: 'uint', bitLength: 8, default: 2 },
      ],
      providesNamespaces: [],
      encapsulations: [],
    };
    const tinyRegistry = createRegistry([tiny]);
    const packet = serializeStack({ layers: [newLayer('tiny')] }, tinyRegistry);
    const questions = generateQuestions(packet, tinyRegistry, { rng: mulberry32(1), count: 20 });

    expect(questions.some((q) => q.kind === 'field-at-span')).toBe(false);
    // With no other protocol in the registry there is nothing to confuse it
    // with either, so the protocol question is skipped rather than padded.
    expect(questions.some((q) => q.kind === 'protocol-at-span')).toBe(false);
  });

  it('covers a custom protocol with no special handling', () => {
    const custom: ProtocolDefinition = {
      id: 'custom-thing',
      name: 'Custom Thing',
      layerHint: 'application',
      source: 'custom',
      fields: [
        { id: 'version', name: 'Version', type: 'uint', bitLength: 8, default: 3 },
        { id: 'kind', name: 'Kind', type: 'uint', bitLength: 8, default: 7 },
        { id: 'length', name: 'Length', type: 'uint', bitLength: 16, default: 12 },
        { id: 'token', name: 'Token', type: 'uint', bitLength: 32, default: 99 },
      ],
      providesNamespaces: [],
      encapsulations: [{ namespaceId: 'udp-dstport', value: 9999 }],
    };
    const withCustom = createBuiltinRegistry([custom]);
    const packet = serializeStack(
      { layers: ['ethernet', 'ipv4', 'udp', 'custom-thing'].map(newLayer) },
      withCustom,
    );
    const questions = generateQuestions(packet, withCustom, {
      rng: mulberry32(11),
      count: 300,
    });

    expect(questions.some((q) => q.protocolId === 'custom-thing')).toBe(true);
    const fieldQuestion = questions.find(
      (q) => q.protocolId === 'custom-thing' && q.kind === 'field-at-span',
    )!;
    expect(fieldQuestion.choices.map((c) => c.label).sort()).toEqual(
      ['Kind', 'Length', 'Token', 'Version'].sort(),
    );
  });
});

describe('generateRound', () => {
  it('draws a random stack with questions about it', () => {
    const round = generateRound(registry, 'random', { rng: mulberry32(7), count: 4 })!;
    expect(round.stack.layers.length).toBeGreaterThan(0);
    expect(round.questions.length).toBeGreaterThan(0);
    expect(round.questions.length).toBeLessThanOrEqual(4);
    expect(round.packet.bytes.length).toBeGreaterThan(0);
    expect(round.sourceLabel).toBe('Randomly generated stack');
  });

  it('draws a curated preset and names it', () => {
    const round = generateRound(registry, 'curated', { rng: mulberry32(3), count: 4 })!;
    expect(round.sourceLabel).toMatch(/^Preset: /);
    expect(round.questions.length).toBeGreaterThan(0);
  });

  it('asks only about bytes of the packet it drew', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const round = generateRound(registry, 'random', { rng: mulberry32(seed), count: 5 });
      expect(round, `seed ${seed}`).not.toBeNull();
      for (const question of round!.questions) {
        expect(question.range.offset + question.range.length).toBeLessThanOrEqual(
          round!.packet.bytes.length,
        );
      }
    }
  });

  it('returns null when the library cannot support any question', () => {
    const empty = createRegistry([]);
    expect(generateRound(empty, 'random', { rng: mulberry32(1) })).toBeNull();
  });
});

describe('describeValue', () => {
  const field = (over: Partial<Parameters<typeof describeValue>[0]> = {}) => ({
    id: 'f',
    name: 'F',
    type: 'uint' as const,
    bitLength: 8,
    ...over,
  });

  it('shows hex alongside wide integers only', () => {
    expect(describeValue(field(), 64)).toBe('64');
    expect(describeValue(field({ bitLength: 16 }), 4660)).toBe('4660 (0x1234)');
  });

  it('renders addresses in their conventional form', () => {
    expect(describeValue(field({ type: 'ipv4', bitLength: 32 }), '192.0.2.1')).toBe('192.0.2.1');
    expect(describeValue(field({ type: 'mac', bitLength: 48 }), '02:00:00:00:00:01')).toBe(
      '02:00:00:00:00:01',
    );
  });

  it('summarises long byte and text values rather than dumping them', () => {
    const long = new Uint8Array(32).fill(0xab);
    expect(describeValue(field({ type: 'bytes', bitLength: 'auto' }), long)).toMatch(/…$/);
    expect(describeValue(field({ type: 'bytes', bitLength: 'auto' }), new Uint8Array(0))).toBe(
      '(empty)',
    );
    expect(
      describeValue(field({ type: 'string', bitLength: 'auto' }), 'x'.repeat(80)),
    ).toHaveLength(40);
  });
});

describe('scoring', () => {
  it('counts answers and tracks the current streak', () => {
    let score = EMPTY_SCORE;
    score = scoreAnswer(score, true);
    score = scoreAnswer(score, true);
    expect(score).toEqual({ asked: 2, correct: 2, streak: 2, bestStreak: 2 });
  });

  it('breaks the streak on a wrong answer but keeps the best', () => {
    let score = EMPTY_SCORE;
    score = scoreAnswer(score, true);
    score = scoreAnswer(score, true);
    score = scoreAnswer(score, false);
    expect(score).toMatchObject({ asked: 3, correct: 2, streak: 0, bestStreak: 2 });

    score = scoreAnswer(score, true);
    expect(score).toMatchObject({ streak: 1, bestStreak: 2 });
  });

  it('reports accuracy as a whole percentage, and zero before any answer', () => {
    expect(accuracy(EMPTY_SCORE)).toBe(0);
    expect(accuracy({ asked: 3, correct: 2, streak: 0, bestStreak: 1 })).toBe(67);
    expect(accuracy({ asked: 4, correct: 4, streak: 4, bestStreak: 4 })).toBe(100);
  });

  it('does not mutate the score it is given', () => {
    const start = EMPTY_SCORE;
    scoreAnswer(start, true);
    expect(start).toEqual({ asked: 0, correct: 0, streak: 0, bestStreak: 0 });
  });
});
