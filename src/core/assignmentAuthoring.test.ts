import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../protocols';
import { newLayer } from './model';
import {
  createAssignmentDraft,
  createManualQuestion,
  referencedQuizProtocols,
  reviewAssignment,
  savedAssignmentStack,
  snapshotAssignmentPacket,
} from './assignmentAuthoring';
import { exportQuizPackage, generateAssignmentQuestions, parseQuizPackage } from './assignmentQuiz';

const registry = createBuiltinRegistry();
const stack = () => ({
  layers: [newLayer('ethernet'), newLayer('ipv4'), newLayer('tcp')],
  trailingPayload: new Uint8Array([1, 2, 3]),
});

describe('assignment authoring', () => {
  it('snapshots packet values and source identity independently of subsequent edits', () => {
    const original = stack();
    original.layers[1]!.overrides.ttl = 63;
    const packet = snapshotAssignmentPacket(
      'Step 2',
      { kind: 'scenario', id: 'scenario/step-2' },
      original,
      registry,
    );
    original.layers[1]!.overrides.ttl = 5;
    original.trailingPayload[0] = 9;
    expect(packet.stack.layers[1]!.overrides.ttl).toBe(63);
    expect(packet.stack.trailingPayload).toEqual(new Uint8Array([1, 2, 3]));
    expect(packet.source.id).toBe('scenario/step-2');
  });

  it('restores saved stacks with fresh layer identities', () => {
    const saved = {
      id: 'saved',
      name: 'Request',
      savedAt: 0,
      layers: stack().layers,
      trailingPayload: new Uint8Array(),
    };
    const restored = savedAssignmentStack(saved);
    expect(restored.layers[0]!.uid).not.toBe(saved.layers[0]!.uid);
    expect(restored.layers.map((item) => item.protocolId)).toEqual(['ethernet', 'ipv4', 'tcp']);
  });

  it('reviews incomplete drafts and invalid answer targets before export', () => {
    const quiz = createAssignmentDraft();
    expect(
      reviewAssignment(quiz, registry).filter((item) => item.severity === 'error'),
    ).toHaveLength(3);
    const packet = snapshotAssignmentPacket('Builder', { kind: 'builder' }, stack(), registry);
    const question = {
      ...createManualQuestion(packet, registry),
      prompt: 'Which field?',
      correctChoiceId: 'missing',
    };
    const ready = {
      ...quiz,
      title: 'Lesson',
      packets: [packet],
      questions: [question],
    };
    expect(
      reviewAssignment(ready, registry).some((item) =>
        item.message.includes('Correct choice is missing'),
      ),
    ).toBe(true);
    expect(
      reviewAssignment(
        {
          ...ready,
          questions: [
            {
              ...question,
              correctChoiceId: question.choices[0]!.id,
              focus: { layerIndex: 0, byteRange: { offset: 9999, length: 1 } },
            },
          ],
        },
        registry,
      ).some((item) => item.message.includes('byteRange.offset')),
    ).toBe(true);
  });

  it('creates malformed candidates only for anchored diagnostics and preserves their wire values', () => {
    const valid = snapshotAssignmentPacket('Ordinary TCP', { kind: 'builder' }, stack(), registry);
    expect(
      generateAssignmentQuestions(valid, registry).filter((item) => item.kind === 'invalid-field'),
    ).toEqual([]);
    const original = stack();
    original.layers[2]!.overrides.flags = 3; // SYN + FIN
    const packet = snapshotAssignmentPacket(
      'Contradictory TCP',
      { kind: 'builder' },
      original,
      registry,
    );
    const candidates = generateAssignmentQuestions(packet, registry).filter(
      (item) => item.kind === 'invalid-field',
    );
    expect(
      candidates.some(
        (item) => item.focus.fieldId === 'flags' && item.explanation.includes('SYN and FIN'),
      ),
    ).toBe(true);
    expect(candidates.every((item) => item.focus.fieldId && item.focus.byteRange.length > 0)).toBe(
      true,
    );
    const unanchored = snapshotAssignmentPacket(
      'TCP without carrier',
      { kind: 'builder' },
      { layers: [newLayer('tcp')] },
      registry,
    );
    expect(
      generateAssignmentQuestions(unanchored, registry)
        .filter((item) => item.kind === 'invalid-field')
        .some((item) => item.explanation.includes('cannot start')),
    ).toBe(false);
    const quiz = {
      ...createAssignmentDraft(),
      title: 'Malformed lesson',
      packets: [packet],
      questions: candidates,
    };
    expect(reviewAssignment(quiz, registry).filter((item) => item.severity === 'error')).toEqual(
      [],
    );
    expect(parseQuizPackage(exportQuizPackage(quiz)).quiz.packets[0]!.expectedBytes).toEqual(
      packet.expectedBytes,
    );
  });

  it('automatically bundles only custom definitions referenced by selected packets', () => {
    const custom = {
      ...registry.get('ethernet')!,
      id: 'lesson-link',
      name: 'Lesson link',
    };
    const unused = { ...custom, id: 'unused-link' };
    const isolated = createBuiltinRegistry([custom, unused]);
    const packet = snapshotAssignmentPacket(
      'Custom',
      { kind: 'saved-stack', id: 'saved-1' },
      { layers: [newLayer(custom.id)] },
      isolated,
    );
    const protocols = referencedQuizProtocols([packet], [custom, unused]);
    expect(protocols.map((item) => item.id)).toEqual(['lesson-link']);
    const question = {
      ...createManualQuestion(packet, isolated),
      prompt: 'Inspect the header',
    };
    const quiz = {
      ...createAssignmentDraft(),
      title: 'Custom lesson',
      customProtocols: protocols,
      packets: [packet],
      questions: [question],
    };
    expect(parseQuizPackage(exportQuizPackage(quiz)).registry.get('lesson-link')).toBeDefined();
    expect(referencedQuizProtocols([], protocols)).toEqual([]);
  });
});
