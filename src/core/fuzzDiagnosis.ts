/**
 * Why a receiver would reject a fuzzed packet.
 *
 * "The checksum is wrong" is a fact; "the dissector read four layers, then
 * stopped inside the TCP header because the packet ends before the header
 * does" is an explanation. This module produces the second kind by running
 * the corrupted bytes through the three things that would reject them in
 * practice, in the order a receiver meets them:
 *
 * 1. **The dissector** — `decodeStackBytes` walks the mutated bytes from the
 *    same outermost protocol, and reports where it got to and why it stopped.
 *    This is the only check that sees truncated and extended packets, since
 *    they have no stack to validate.
 * 2. **Structural validation** — `validateStack`, for the mutated stack.
 * 3. **Semantic lint** — `lintPacket`, for values that are encodable but
 *    wrong.
 *
 * Both issue lists are reported as a *diff* against the unmutated packet.
 * A stack can be imperfect before anyone fuzzes it, and repeating the
 * pre-existing warnings would bury the one line that answers the question.
 */
import { decodeStackBytes } from './decodeStack';
import type { StackInstance } from './model';
import type { Registry } from './registry';
import { serializeStack, type SerializedPacket } from './serialize';
import { lintPacket, type SemanticLintIssue } from './semanticLint';
import { validateStack, type ValidationIssue } from './validate';
import type { FuzzResult } from './fuzz';

export type DiagnosisSeverity = 'ok' | 'warning' | 'error';

export interface DiagnosisStep {
  /** Which of the three checks produced this. */
  stage: 'decode' | 'validation' | 'lint';
  severity: DiagnosisSeverity;
  title: string;
  detail: string;
}

export interface FuzzDiagnosis {
  /** Protocol names the dissector could still read, outermost first. */
  decodedLayers: string[];
  /** How many the unmutated packet had, for the "3 of 4" reading. */
  baselineLayers: number;
  /** True when re-reading the mutated bytes reproduces them exactly. */
  decodeExact: boolean;
  /** Issues the mutation introduced — not every issue the packet has. */
  introducedValidation: ValidationIssue[];
  introducedLint: SemanticLintIssue[];
  steps: DiagnosisStep[];
}

/** Identity of an issue, for diffing before against after. */
const validationKey = (issue: ValidationIssue) =>
  `${issue.code}|${issue.layerIndex}|${issue.fieldId ?? ''}|${issue.message}`;
const lintKey = (issue: SemanticLintIssue) =>
  `${issue.code}|${issue.layerIndex}|${issue.fieldId}`;

export function diagnoseFuzz(
  baseline: { stack: StackInstance; packet: SerializedPacket },
  mutated: FuzzResult,
  registry: Registry,
): FuzzDiagnosis {
  const startProtocolId = baseline.stack.layers[0]?.protocolId;
  const baselineLayers = baseline.stack.layers.length;
  const steps: DiagnosisStep[] = [];

  // 1. The dissector, on the raw mutated bytes.
  let decodedLayers: string[] = [];
  let decodeExact = false;
  if (startProtocolId) {
    try {
      const decoded = decodeStackBytes(mutated.bytes, registry, startProtocolId);
      decodedLayers = decoded.layers.map(
        (layer) => registry.get(layer.protocolId)?.name ?? layer.protocolId,
      );
      decodeExact = decoded.exact;
      steps.push(decodeStep(decoded.notes, decodedLayers, baselineLayers, decoded.exact));
    } catch (e) {
      steps.push({
        stage: 'decode',
        severity: 'error',
        title: 'The dissector could not start',
        detail: `Reading the packet threw before any layer was identified: ${(e as Error).message}`,
      });
    }
  }

  // 2 and 3 need a stack; truncation and extension deliberately have none.
  if (!mutated.stack) {
    steps.push({
      stage: 'validation',
      severity: 'warning',
      title: 'Structural validation does not apply',
      detail:
        mutated.foldbackNote ??
        'The mutated bytes do not form a stack, so only the dissector’s reading is available.',
    });
    return {
      decodedLayers,
      baselineLayers,
      decodeExact,
      introducedValidation: [],
      introducedLint: [],
      steps,
    };
  }

  let mutatedPacket: SerializedPacket | null = null;
  try {
    mutatedPacket = serializeStack(mutated.stack, registry);
  } catch (e) {
    steps.push({
      stage: 'validation',
      severity: 'error',
      title: 'The mutated packet no longer serializes',
      detail: `Rebuilding it failed: ${(e as Error).message}. A sender could not even emit this packet.`,
    });
  }

  const before = new Set(validateStack(baseline.stack, registry, baseline.packet).map(validationKey));
  const introducedValidation = validateStack(mutated.stack, registry, mutatedPacket ?? undefined)
    .filter((issue) => !before.has(validationKey(issue)))
    .filter((issue) => issue.severity !== 'info');
  steps.push(issueStep('validation', introducedValidation.length, 'structural'));

  const introducedLint: SemanticLintIssue[] = [];
  if (mutatedPacket) {
    const lintBefore = new Set(
      lintPacket(baseline.stack, registry, baseline.packet).map(lintKey),
    );
    introducedLint.push(
      ...lintPacket(mutated.stack, registry, mutatedPacket).filter(
        (issue) => !lintBefore.has(lintKey(issue)),
      ),
    );
  }
  steps.push(issueStep('lint', introducedLint.length, 'semantic'));

  return {
    decodedLayers,
    baselineLayers,
    decodeExact,
    introducedValidation,
    introducedLint,
    steps,
  };
}

/** Narrate how far the dissector got and what stopped it. */
function decodeStep(
  notes: string[],
  decodedLayers: string[],
  baselineLayers: number,
  exact: boolean,
): DiagnosisStep {
  const read = decodedLayers.length;
  if (read === 0) {
    return {
      stage: 'decode',
      severity: 'error',
      title: 'No layer could be read',
      detail:
        notes[0] ??
        'The dissector could not identify even the outermost header — a receiver would drop the frame immediately.',
    };
  }
  if (read < baselineLayers) {
    return {
      stage: 'decode',
      severity: 'error',
      title: `The dissector stopped after ${read} of ${baselineLayers} layers`,
      detail: `It read ${decodedLayers.join(' › ')} and went no further. ${
        notes[0] ?? 'Everything beyond that is unparsed bytes to a receiver.'
      }`,
    };
  }
  if (!exact) {
    return {
      stage: 'decode',
      severity: 'warning',
      title: 'Every layer still parses, but not byte-exactly',
      detail: `${decodedLayers.join(' › ')} were all identified. ${
        notes[0] ?? 'Re-encoding what was read does not reproduce these bytes, so some field disagrees with its own header.'
      }`,
    };
  }
  return {
    stage: 'decode',
    severity: 'ok',
    title: 'The packet still dissects cleanly',
    detail: `${decodedLayers.join(' › ')} all parse, and re-encoding reproduces the bytes exactly. The corruption is in a value, not the structure.`,
  };
}

function issueStep(
  stage: 'validation' | 'lint',
  count: number,
  kind: string,
): DiagnosisStep {
  const label = stage === 'validation' ? 'Structural validation' : 'Semantic lint';
  return {
    stage,
    severity: count === 0 ? 'ok' : stage === 'validation' ? 'error' : 'warning',
    title: count === 0 ? `${label} found nothing new` : `${label}: ${count} new ${count === 1 ? 'issue' : 'issues'}`,
    detail:
      count === 0
        ? `The mutation introduced no ${kind} problems the packet did not already have.`
        : `The mutation introduced ${count} ${kind} ${count === 1 ? 'problem' : 'problems'}, listed below.`,
  };
}
