import { newLayer, type StackInstance, type ProtocolDefinition } from './model';
import type { Registry } from './registry';
import { snapshotStack } from './scenarioComposer';
import { serializeStack } from './serialize';
import { validateStack } from './validate';
import {
  exportQuizPackage,
  QUIZ_APP,
  QUIZ_KIND,
  QUIZ_VERSION,
  type AssignmentPacket,
  type AssignmentQuestion,
  type QuizPackage,
} from './assignmentQuiz';
import type { SavedStack } from '../store/persistence';

export function createAssignmentDraft(): QuizPackage {
  return {
    app: QUIZ_APP,
    kind: QUIZ_KIND,
    version: QUIZ_VERSION,
    quizId: crypto.randomUUID(),
    title: '',
    description: '',
    educator: '',
    course: '',
    createdAt: new Date().toISOString(),
    feedbackMode: 'instant',
    customProtocols: [],
    packets: [],
    questions: [],
  };
}

export function snapshotAssignmentPacket(
  label: string,
  source: AssignmentPacket['source'],
  stack: StackInstance,
  registry: Registry,
): AssignmentPacket {
  if (!stack.layers.length)
    throw new Error('This packet has no layers. Add a protocol in Stack Builder first.');
  const snapshot = snapshotStack(stack);
  const serialized = serializeStack(snapshot, registry);
  const error = serialized.issues.find((issue) => issue.severity === 'error');
  if (error) throw new Error(error.message);
  return {
    id: crypto.randomUUID(),
    label,
    source,
    stack: snapshot,
    expectedBytes: serialized.bytes,
  };
}

export function savedAssignmentStack(saved: SavedStack): StackInstance {
  return {
    layers: saved.layers.map((layer) => ({
      ...newLayer(layer.protocolId),
      overrides: layer.overrides,
      pinned: layer.pinned,
    })),
    trailingPayload: saved.trailingPayload,
  };
}

export function referencedQuizProtocols(
  packets: AssignmentPacket[],
  definitions: ProtocolDefinition[],
): ProtocolDefinition[] {
  const ids = new Set(
    packets.flatMap((packet) => packet.stack.layers.map((layer) => layer.protocolId)),
  );
  return definitions.filter((definition) => ids.has(definition.id));
}

export function createManualQuestion(
  packet: AssignmentPacket,
  registry: Registry,
): AssignmentQuestion {
  const layer = serializeStack(packet.stack, registry).layers[0]!;
  const choices = [1, 2].map((n) => ({
    id: crypto.randomUUID(),
    label: `Choice ${n}`,
  }));
  return {
    id: crypto.randomUUID(),
    kind: 'multiple-choice',
    packetId: packet.id,
    prompt: '',
    choices,
    correctChoiceId: choices[0]!.id,
    explanation: '',
    focus: {
      layerIndex: 0,
      byteRange: { offset: layer.byteOffset, length: layer.headerBytes },
    },
  };
}

export interface AuthoringDiagnostic {
  severity: 'error' | 'warning';
  message: string;
}

/** Collect editor diagnostics without requiring incomplete drafts to be valid packages. */
export function reviewAssignment(quiz: QuizPackage, registry: Registry): AuthoringDiagnostic[] {
  const diagnostics: AuthoringDiagnostic[] = [];
  if (!quiz.title.trim())
    diagnostics.push({
      severity: 'error',
      message: 'Enter an assignment title.',
    });
  if (!quiz.packets.length)
    diagnostics.push({
      severity: 'error',
      message: 'Select at least one packet.',
    });
  if (!quiz.questions.length)
    diagnostics.push({
      severity: 'error',
      message: 'Add at least one question.',
    });
  for (const packet of quiz.packets) {
    try {
      const serialized = serializeStack(packet.stack, registry);
      const findings = [...serialized.issues, ...validateStack(packet.stack, registry, serialized)];
      for (const finding of findings) {
        if (finding.severity === 'info') continue;
        // Semantic and field validation findings can be intentional teaching
        // material. Serialization errors still prevent a portable package.
        diagnostics.push({
          severity:
            serialized.issues.includes(finding as (typeof serialized.issues)[number]) &&
            finding.severity === 'error'
              ? 'error'
              : 'warning',
          message: `${packet.label}: ${finding.message}`,
        });
      }
    } catch (error) {
      diagnostics.push({
        severity: 'error',
        message: `${packet.label}: ${error instanceof Error ? error.message : 'Could not serialize packet.'}`,
      });
    }
  }
  for (const [index, question] of quiz.questions.entries()) {
    try {
      exportQuizPackage({
        ...quiz,
        title: quiz.title.trim() || 'Draft',
        questions: [question],
      });
    } catch (error) {
      diagnostics.push({
        severity: 'error',
        message: `Question ${index + 1}: ${error instanceof Error ? error.message : 'Invalid question.'}`,
      });
    }
  }
  if (!diagnostics.some((item) => item.severity === 'error')) {
    try {
      exportQuizPackage(quiz);
    } catch (error) {
      diagnostics.push({
        severity: 'error',
        message: error instanceof Error ? error.message : 'Invalid package.',
      });
    }
  }
  return diagnostics;
}
