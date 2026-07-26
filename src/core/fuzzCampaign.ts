/**
 * Batch fuzzing: run many seeds and report what actually broke.
 *
 * One mutation answers "what does this do". A campaign answers the more
 * useful question — "which of these mutations matter". Most random bit flips
 * land in an address or a payload byte and produce a packet that still
 * dissects perfectly; the interesting seeds are the few that stop a dissector
 * dead. Grouping runs by outcome makes that ratio visible instead of leaving
 * it to be discovered one seed at a time.
 *
 * Each run is the same `fuzzPacket` + `diagnoseFuzz` pair the interactive view
 * uses, at the same seed, so any row can be reopened and inspected in full —
 * the campaign is an index into reproducible single runs, not a separate
 * pipeline that might disagree with them.
 */
import { fuzzPacket, FuzzError, type FuzzTarget, type MutationStrategy } from './fuzz';
import { diagnoseFuzz, type FuzzDiagnosis } from './fuzzDiagnosis';
import type { StackInstance } from './model';
import type { Registry } from './registry';
import type { SerializedPacket } from './serialize';

/**
 * What a receiver would do with the result, worst first. A run is filed under
 * the first outcome that applies, so "it still dissects" never hides the fact
 * that a checksum is now wrong.
 */
export const OUTCOMES = [
  'refused',
  'no-layers-decoded',
  'stops-early',
  'validation-error',
  'not-byte-exact',
  'decodes-cleanly',
] as const;
export type CampaignOutcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABELS: Record<CampaignOutcome, string> = {
  refused: 'Mutation not applicable',
  'no-layers-decoded': 'Undissectable',
  'stops-early': 'Dissector stops early',
  'validation-error': 'Structurally invalid',
  'not-byte-exact': 'Parses, but inconsistent',
  'decodes-cleanly': 'Still dissects cleanly',
};

export interface CampaignRun {
  seed: number;
  strategy: MutationStrategy;
  outcome: CampaignOutcome;
  /** One line for the results table. */
  summary: string;
  /** Absent when the mutation could not be applied at this seed. */
  diagnosis?: FuzzDiagnosis;
  mutationCount: number;
}

export interface OutcomeGroup {
  outcome: CampaignOutcome;
  label: string;
  count: number;
  /** Seeds filed under this outcome, for reopening one. */
  seeds: number[];
}

export interface CampaignOptions {
  /** First seed; the campaign walks upward from here so a run is nameable. */
  startSeed: number;
  runs: number;
  strategies: MutationStrategy[];
  count: number;
  target: FuzzTarget;
  allowLengthChange?: boolean;
}

export interface CampaignResult {
  runs: CampaignRun[];
  groups: OutcomeGroup[];
}

/**
 * Hard ceiling on runs. Each one serializes and re-decodes a packet, and this
 * is synchronous on the UI thread — a few hundred is imperceptible, thousands
 * would not be.
 */
export const MAX_RUNS = 200;

export function runCampaign(
  stack: StackInstance,
  packet: SerializedPacket,
  registry: Registry,
  options: CampaignOptions,
): CampaignResult {
  const strategies = options.strategies.length > 0 ? options.strategies : ['bit-flip' as const];
  const total = Math.max(1, Math.min(MAX_RUNS, options.runs));
  const runs: CampaignRun[] = [];

  for (let i = 0; i < total; i++) {
    const seed = options.startSeed + i;
    // Cycle strategies rather than randomising, so a mixed campaign gives
    // each one the same number of attempts and the comparison is fair.
    const strategy = strategies[i % strategies.length]!;
    runs.push(runOne(stack, packet, registry, seed, strategy, options));
  }

  return { runs, groups: group(runs) };
}

function runOne(
  stack: StackInstance,
  packet: SerializedPacket,
  registry: Registry,
  seed: number,
  strategy: MutationStrategy,
  options: CampaignOptions,
): CampaignRun {
  try {
    const result = fuzzPacket(stack, packet, registry, {
      seed,
      strategy,
      count: options.count,
      target: options.target,
      ...(options.allowLengthChange !== undefined
        ? { allowLengthChange: options.allowLengthChange }
        : {}),
    });
    const diagnosis = diagnoseFuzz({ stack, packet }, result, registry);
    const outcome = classify(diagnosis);
    return {
      seed,
      strategy,
      outcome,
      summary: summarize(outcome, diagnosis),
      diagnosis,
      mutationCount: result.mutations.length,
    };
  } catch (e) {
    return {
      seed,
      strategy,
      outcome: 'refused',
      summary: e instanceof FuzzError ? e.message : (e as Error).message,
      mutationCount: 0,
    };
  }
}

function classify(diagnosis: FuzzDiagnosis): CampaignOutcome {
  if (diagnosis.decodedLayers.length === 0) return 'no-layers-decoded';
  if (diagnosis.decodedLayers.length < diagnosis.baselineLayers) return 'stops-early';
  if (diagnosis.introducedValidation.some((issue) => issue.severity === 'error')) {
    return 'validation-error';
  }
  if (!diagnosis.decodeExact) return 'not-byte-exact';
  return 'decodes-cleanly';
}

function summarize(outcome: CampaignOutcome, diagnosis: FuzzDiagnosis): string {
  switch (outcome) {
    case 'no-layers-decoded':
      return 'Not even the outermost header could be read.';
    case 'stops-early':
      return `Read ${diagnosis.decodedLayers.length} of ${diagnosis.baselineLayers} layers: ${diagnosis.decodedLayers.join(' › ')}.`;
    case 'validation-error':
      return diagnosis.introducedValidation[0]?.message ?? 'Structural validation failed.';
    case 'not-byte-exact':
      return 'Every layer parses, but the packet disagrees with its own headers.';
    case 'decodes-cleanly':
      return diagnosis.introducedLint.length > 0
        ? `Dissects cleanly; ${diagnosis.introducedLint.length} new semantic warning(s).`
        : 'Dissects cleanly — the corruption changed a value, not the structure.';
    case 'refused':
      return 'The mutation could not be applied.';
  }
}

/** Group runs by outcome, in OUTCOMES order, dropping empty groups. */
function group(runs: CampaignRun[]): OutcomeGroup[] {
  return OUTCOMES.flatMap((outcome) => {
    const matching = runs.filter((run) => run.outcome === outcome);
    return matching.length === 0
      ? []
      : [
          {
            outcome,
            label: OUTCOME_LABELS[outcome],
            count: matching.length,
            seeds: matching.map((run) => run.seed),
          },
        ];
  });
}
