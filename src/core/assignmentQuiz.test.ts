import { describe, expect, it } from 'vitest';
import { newLayer } from './model';
import { serializeStack } from './serialize';
import { createBuiltinRegistry } from '../protocols';
import { exportQuizPackage, parseQuizPackage, type QuizPackage } from './assignmentQuiz';
import { answerQuestion, buildPrintableResult, createAttempt, reviewAttempt, scoreAttempt, shuffledChoices, submitAttempt } from './quizAttempt';

function fixture(): QuizPackage {
  const registry = createBuiltinRegistry(); const stack = { layers: [newLayer('ethernet'), newLayer('ipv4')], trailingPayload: new Uint8Array() }; const expectedBytes = serializeStack(stack, registry).bytes;
  return { app: 'proto-viz', kind: 'quiz', version: 1, quizId: 'quiz-1', title: 'Packet quiz', description: '', educator: 'Ada', course: 'NET 101', createdAt: '2026-08-14T12:00:00.000Z', feedbackMode: 'on-submit', customProtocols: [], packets: [{ id: 'packet-1', label: 'Packet', source: { kind: 'builder' }, stack, expectedBytes }], questions: [{ id: 'question-1', kind: 'multiple-choice', packetId: 'packet-1', prompt: 'Pick one', choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], correctChoiceId: 'b', explanation: 'B is correct.', focus: { layerIndex: 0, byteRange: { offset: 0, length: 1 } } }] };
}

describe('quiz packages', () => {
  it('round-trips stack-backed packets through the workspace codec', () => { const parsed = parseQuizPackage(exportQuizPackage(fixture())); expect(parsed.quiz.packets[0]!.expectedBytes).toEqual(fixture().packets[0]!.expectedBytes); expect(parsed.registry.get('ethernet')).toBeDefined(); });
  it('rejects future versions', () => { const value = JSON.parse(exportQuizPackage(fixture())); value.version = 2; expect(() => parseQuizPackage(JSON.stringify(value))).toThrow(/newer/); });
  it('rejects expected-byte changes and invalid references', () => { const value = JSON.parse(exportQuizPackage(fixture())); value.packets[0].expectedBytes.$bytes = 'AA=='; expect(() => parseQuizPackage(JSON.stringify(value))).toThrow(/Expected bytes/); value.packets[0].expectedBytes = JSON.parse(exportQuizPackage(fixture())).packets[0].expectedBytes; value.questions[0].packetId = 'missing'; expect(() => parseQuizPackage(JSON.stringify(value))).toThrow(/unknown packet/); });
});

describe('quiz attempts', () => {
  it('keeps question order, shuffles choices deterministically, scores one point, and defers review', () => { const quiz = fixture(); const attempt = createAttempt(quiz, 'fingerprint', { name: 'Student', email: 's@example.test' }, '2026-08-14T12:01:00.000Z', 42); expect(shuffledChoices(quiz.questions[0]!, 42)).toEqual(shuffledChoices(quiz.questions[0]!, 42)); const answered = answerQuestion(attempt, 'question-1', 'b'); expect(reviewAttempt(answered)).toEqual([]); expect(scoreAttempt(answered)).toEqual({ correct: 1, total: 1, percentage: 100 }); const submitted = submitAttempt(answered, '2026-08-14T12:02:00.000Z'); expect(reviewAttempt(submitted)[0]!.verdict).toBe('correct'); expect(buildPrintableResult(submitted).disclosure).toMatch(/locally/); });
  it('locks instant answers', () => { const quiz = { ...fixture(), feedbackMode: 'instant' as const }; const attempt = createAttempt(quiz, 'fingerprint', { name: 'Student', email: 's@example.test' }, undefined, 1); const answered = answerQuestion(attempt, 'question-1', 'a'); expect(answerQuestion(answered, 'question-1', 'b')).toBe(answered); expect(reviewAttempt(answered)[0]!.verdict).toBe('incorrect'); });
});

