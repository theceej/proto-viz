import type { ProtocolDefinition, StackInstance } from './model';
import type { Registry } from './registry';
import { serializeStack } from './serialize';
import { generateQuestions } from './quiz';
import { createBuiltinRegistry } from '../protocols';
import {
  createWorkspaceWireBudget,
  decodeWorkspaceBytes,
  decodeWorkspaceProtocols,
  decodeWorkspaceStack,
  encodeWorkspaceBytes,
  encodeWorkspaceProtocol,
  encodeWorkspaceStack,
} from '../store/workspaceJson';

export const QUIZ_APP = 'proto-viz';
export const QUIZ_KIND = 'quiz';
export const QUIZ_VERSION = 1;
export const QUIZ_EXTENSION = '.protoviz-quiz';
export const QUIZ_MAX_TEXT_BYTES = 10 * 1024 * 1024;
export const QUIZ_MAX_PACKETS = 100;
export const QUIZ_MAX_QUESTIONS = 500;

export type AssignmentQuestionKind =
  | 'protocol-identification'
  | 'field-identification'
  | 'field-value'
  | 'payload-length'
  | 'invalid-field'
  | 'multiple-choice';

export interface AssignmentChoice { id: string; label: string }
export interface AssignmentFocus { layerIndex: number; fieldId?: string; byteRange: { offset: number; length: number } }
export interface AssignmentQuestion {
  id: string;
  kind: AssignmentQuestionKind;
  packetId: string;
  prompt: string;
  choices: AssignmentChoice[];
  correctChoiceId: string;
  explanation: string;
  focus: AssignmentFocus;
}
export interface AssignmentPacket {
  id: string;
  label: string;
  source: { kind: 'builder' | 'saved-stack' | 'scenario'; id?: string; label?: string };
  stack: StackInstance;
  expectedBytes: Uint8Array;
}
export interface QuizPackage {
  app: typeof QUIZ_APP;
  kind: typeof QUIZ_KIND;
  version: typeof QUIZ_VERSION;
  quizId: string;
  title: string;
  description: string;
  educator: string;
  course: string;
  createdAt: string;
  feedbackMode: 'instant' | 'on-submit';
  customProtocols: ProtocolDefinition[];
  packets: AssignmentPacket[];
  questions: AssignmentQuestion[];
}
export interface ParsedQuizPackage { quiz: QuizPackage; registry: Registry; fingerprint: string }

export class QuizPackageError extends Error {
  constructor(readonly code: string, message: string, readonly path?: string) {
    super(message); this.name = 'QuizPackageError';
  }
}

type JsonObject = Record<string, unknown>;
const object = (value: unknown, path: string): JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new QuizPackageError('INVALID_SCHEMA', `Expected an object at ${path}.`, path);
  return value as JsonObject;
};
const text = (value: unknown, path: string, allowEmpty = true): string => {
  if (typeof value !== 'string' || value.length > 256 * 1024 || (!allowEmpty && value.trim() === '')) throw new QuizPackageError('INVALID_STRING', `Invalid string at ${path}.`, path);
  return value;
};
const list = (value: unknown, path: string, max: number): unknown[] => {
  if (!Array.isArray(value)) throw new QuizPackageError('INVALID_SCHEMA', `Expected an array at ${path}.`, path);
  if (value.length > max) throw new QuizPackageError('ARRAY_LIMIT', `${path} exceeds the limit of ${max}.`, path);
  return value;
};
const integer = (value: unknown, path: string, min: number, max: number): number => {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new QuizPackageError('INVALID_NUMBER', `Invalid integer at ${path}.`, path);
  return value as number;
};
const unique = (values: string[], code: string, path: string) => {
  const seen = new Set<string>();
  for (const value of values) { if (seen.has(value)) throw new QuizPackageError(code, `Duplicate ID "${value}".`, path); seen.add(value); }
};

export function exportQuizPackage(quiz: QuizPackage): string {
  const root = {
    ...quiz,
    customProtocols: quiz.customProtocols.map(encodeWorkspaceProtocol),
    packets: quiz.packets.map((packet) => ({
      id: packet.id, label: packet.label, source: packet.source,
      stack: encodeWorkspaceStack(packet.stack), expectedBytes: encodeWorkspaceBytes(packet.expectedBytes),
    })),
  };
  const result = JSON.stringify(root, null, 2);
  parseQuizPackage(result);
  return result;
}

export function parseQuizPackage(source: string): ParsedQuizPackage {
  if (new TextEncoder().encode(source).byteLength > QUIZ_MAX_TEXT_BYTES) throw new QuizPackageError('TEXT_TOO_LARGE', 'Quiz package exceeds the 10 MiB JSON limit.');
  let raw: unknown;
  try { raw = JSON.parse(source); } catch { throw new QuizPackageError('INVALID_JSON', 'Quiz package is not valid JSON.'); }
  const root = object(raw, '$');
  if (root.app !== QUIZ_APP) throw new QuizPackageError('INVALID_APP', 'Not a proto-viz package.', '$.app');
  if (root.kind !== QUIZ_KIND) throw new QuizPackageError('INVALID_KIND', 'Not a proto-viz quiz package.', '$.kind');
  const version = integer(root.version, '$.version', 0, Number.MAX_SAFE_INTEGER);
  if (version > QUIZ_VERSION) throw new QuizPackageError('FUTURE_VERSION', `Quiz package version ${version} is newer than supported version ${QUIZ_VERSION}.`, '$.version');
  if (version !== QUIZ_VERSION) throw new QuizPackageError('UNSUPPORTED_VERSION', `Unsupported quiz package version ${version}.`, '$.version');
  const createdAt = text(root.createdAt, '$.createdAt', false);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(createdAt) || Number.isNaN(Date.parse(createdAt))) throw new QuizPackageError('INVALID_DATE', 'createdAt must be an ISO date.', '$.createdAt');
  if (root.feedbackMode !== 'instant' && root.feedbackMode !== 'on-submit') throw new QuizPackageError('INVALID_FEEDBACK_MODE', 'feedbackMode must be instant or on-submit.', '$.feedbackMode');
  const budget = createWorkspaceWireBudget();
  const customProtocols = decodeWorkspaceProtocols(root.customProtocols ?? [], '$.customProtocols', budget);
  const registry = createBuiltinRegistry(customProtocols); // deliberately isolated; never enters the library store
  const packets = list(root.packets, '$.packets', QUIZ_MAX_PACKETS).map((entry, index): AssignmentPacket => {
    const path = `$.packets[${index}]`; const value = object(entry, path); const sourceValue = object(value.source, `${path}.source`);
    if (!['builder', 'saved-stack', 'scenario'].includes(String(sourceValue.kind))) throw new QuizPackageError('INVALID_SOURCE', 'Invalid packet source.', `${path}.source.kind`);
    const stack = decodeWorkspaceStack(value.stack, `${path}.stack`, budget);
    const expectedBytes = decodeWorkspaceBytes(value.expectedBytes, `${path}.expectedBytes`, budget);
    for (const [layerIndex, layer] of stack.layers.entries()) if (!registry.get(layer.protocolId)) throw new QuizPackageError('UNKNOWN_PROTOCOL', `Unknown protocol "${layer.protocolId}".`, `${path}.stack.layers[${layerIndex}]`);
    const actual = serializeStack(stack, registry);
    const error = actual.issues.find((issue) => issue.severity === 'error');
    if (error) throw new QuizPackageError('STACK_SERIALIZATION_FAILED', error.message, `${path}.stack`);
    if (!equalBytes(actual.bytes, expectedBytes)) throw new QuizPackageError('EXPECTED_BYTES_MISMATCH', `Expected bytes do not match packet "${String(value.id)}".`, `${path}.expectedBytes`);
    return { id: text(value.id, `${path}.id`, false), label: text(value.label, `${path}.label`, false), source: { kind: sourceValue.kind as AssignmentPacket['source']['kind'], ...(typeof sourceValue.id === 'string' ? { id: sourceValue.id } : {}), ...(typeof sourceValue.label === 'string' ? { label: sourceValue.label } : {}) }, stack, expectedBytes };
  });
  unique(packets.map((packet) => packet.id), 'DUPLICATE_PACKET_ID', '$.packets');
  const packetMap = new Map(packets.map((packet) => [packet.id, packet]));
  const allowedKinds: AssignmentQuestionKind[] = ['protocol-identification', 'field-identification', 'field-value', 'payload-length', 'invalid-field', 'multiple-choice'];
  const questions = list(root.questions, '$.questions', QUIZ_MAX_QUESTIONS).map((entry, index): AssignmentQuestion => {
    const path = `$.questions[${index}]`; const value = object(entry, path); const packetId = text(value.packetId, `${path}.packetId`, false); const packet = packetMap.get(packetId);
    if (!packet) throw new QuizPackageError('MISSING_PACKET_REFERENCE', `Question references unknown packet "${packetId}".`, `${path}.packetId`);
    if (!allowedKinds.includes(value.kind as AssignmentQuestionKind)) throw new QuizPackageError('INVALID_QUESTION_KIND', 'Invalid question kind.', `${path}.kind`);
    const choices = list(value.choices, `${path}.choices`, 6).map((entry, choiceIndex) => { const choice = object(entry, `${path}.choices[${choiceIndex}]`); return { id: text(choice.id, `${path}.choices[${choiceIndex}].id`, false), label: text(choice.label, `${path}.choices[${choiceIndex}].label`, false) }; });
    if (choices.length < 2) throw new QuizPackageError('INVALID_CHOICES', 'Questions require 2–6 choices.', `${path}.choices`);
    unique(choices.map((choice) => choice.id), 'DUPLICATE_CHOICE_ID', `${path}.choices`);
    const correctChoiceId = text(value.correctChoiceId, `${path}.correctChoiceId`, false);
    if (!choices.some((choice) => choice.id === correctChoiceId)) throw new QuizPackageError('INVALID_ANSWER_KEY', 'Correct choice is missing.', `${path}.correctChoiceId`);
    const focusValue = object(value.focus, `${path}.focus`); const layerIndex = integer(focusValue.layerIndex, `${path}.focus.layerIndex`, 0, packet.stack.layers.length - 1); const rangeValue = object(focusValue.byteRange, `${path}.focus.byteRange`); const offset = integer(rangeValue.offset, `${path}.focus.byteRange.offset`, 0, packet.expectedBytes.length); const length = integer(rangeValue.length, `${path}.focus.byteRange.length`, 0, packet.expectedBytes.length - offset); const fieldId = focusValue.fieldId === undefined ? undefined : text(focusValue.fieldId, `${path}.focus.fieldId`, false);
    if (fieldId && !registry.get(packet.stack.layers[layerIndex]!.protocolId)?.fields.some((field) => field.id === fieldId)) throw new QuizPackageError('INVALID_FOCUS_FIELD', `Unknown focus field "${fieldId}".`, `${path}.focus.fieldId`);
    return { id: text(value.id, `${path}.id`, false), kind: value.kind as AssignmentQuestionKind, packetId, prompt: text(value.prompt, `${path}.prompt`, false), choices, correctChoiceId, explanation: text(value.explanation, `${path}.explanation`), focus: { layerIndex, ...(fieldId ? { fieldId } : {}), byteRange: { offset, length } } };
  });
  unique(questions.map((question) => question.id), 'DUPLICATE_QUESTION_ID', '$.questions');
  const quiz: QuizPackage = { app: QUIZ_APP, kind: QUIZ_KIND, version: QUIZ_VERSION, quizId: text(root.quizId, '$.quizId', false), title: text(root.title, '$.title', false), description: text(root.description, '$.description'), educator: text(root.educator, '$.educator'), course: text(root.course, '$.course'), createdAt, feedbackMode: root.feedbackMode as QuizPackage['feedbackMode'], customProtocols, packets, questions };
  return { quiz, registry, fingerprint: fingerprint(source) };
}

export function packageFilename(title: string): string {
  const slug = title.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'assignment';
  return `${slug}${QUIZ_EXTENSION}`;
}

export function generateAssignmentQuestions(packet: AssignmentPacket, registry: Registry): AssignmentQuestion[] {
  const serialized = serializeStack(packet.stack, registry);
  const generated = generateQuestions(serialized, registry, { count: 30, rng: () => 0.42 }).map((question, index): AssignmentQuestion => {
    const layerIndex = packet.stack.layers.findIndex((layer) => layer.uid === question.focus.layerUid);
    return { id: `${packet.id}-generated-${index + 1}`, kind: question.kind === 'protocol-at-span' ? 'protocol-identification' : question.kind === 'field-at-span' ? 'field-identification' : 'field-value', packetId: packet.id, prompt: question.prompt, choices: question.choices.map(({ id, label }) => ({ id, label })), correctChoiceId: question.choices.find((choice) => choice.correct)!.id, explanation: question.explanation, focus: { layerIndex, ...(question.focus.fieldId ? { fieldId: question.focus.fieldId } : {}), byteRange: question.range } };
  });
  for (let i = 0; i < serialized.layers.length; i++) {
    const layer = serialized.layers[i]!; const next = serialized.layers[i + 1]; const payloadLength = (next?.byteOffset ?? serialized.bytes.length) - (layer.byteOffset + layer.headerBytes);
    generated.push({ id: `${packet.id}-payload-${i}`, kind: 'payload-length', packetId: packet.id, prompt: `How many payload bytes follow the ${registry.get(layer.protocolId)?.name ?? layer.protocolId} header before the next boundary?`, choices: distinctNumbers(payloadLength).map((n) => ({ id: String(n), label: `${n} bytes` })), correctChoiceId: String(payloadLength), explanation: `The payload begins at byte ${layer.byteOffset + layer.headerBytes} and ends at byte ${next?.byteOffset ?? serialized.bytes.length}.`, focus: { layerIndex: i, byteRange: { offset: layer.byteOffset, length: layer.headerBytes } } });
  }
  return generated;
}

const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((value, index) => value === b[index]);
const distinctNumbers = (answer: number) => [...new Set([answer, Math.max(0, answer - 1), answer + 1, answer + 4])];
function fingerprint(value: string): string { let hash = 2166136261; const bytes = new TextEncoder().encode(value); for (const byte of bytes) { hash ^= byte; hash = Math.imul(hash, 16777619); } return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`; }

