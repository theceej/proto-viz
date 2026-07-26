import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../protocols';
import { newLayer, type StackInstance } from './model';
import { serializeStack, type SerializedPacket } from './serialize';
import { MAX_RUNS, OUTCOMES, runCampaign, type CampaignOptions } from './fuzzCampaign';

const registry = createBuiltinRegistry();

function build(): { stack: StackInstance; packet: SerializedPacket } {
  const stack: StackInstance = {
    layers: ['ethernet', 'ipv4', 'tcp'].map(newLayer),
    trailingPayload: Uint8Array.from([1, 2, 3, 4]),
  };
  return { stack, packet: serializeStack(stack, registry) };
}

const campaign = (options: Partial<CampaignOptions> = {}) => {
  const { stack, packet } = build();
  return runCampaign(stack, packet, registry, {
    startSeed: 1,
    runs: 20,
    strategies: ['bit-flip'],
    count: 1,
    target: { layerUids: [] },
    ...options,
  });
};

describe('runCampaign', () => {
  it('runs one seed per run, walking upward from the start seed', () => {
    const result = campaign({ startSeed: 100, runs: 5 });
    expect(result.runs.map((run) => run.seed)).toEqual([100, 101, 102, 103, 104]);
  });

  it('is reproducible', () => {
    const strip = (r: ReturnType<typeof campaign>) =>
      r.runs.map((run) => [run.seed, run.strategy, run.outcome, run.summary]);
    expect(strip(campaign({ startSeed: 7 }))).toEqual(strip(campaign({ startSeed: 7 })));
  });

  it('files every run under exactly one known outcome', () => {
    const result = campaign({ runs: 30 });
    for (const run of result.runs) expect(OUTCOMES).toContain(run.outcome);
    expect(result.groups.reduce((total, group) => total + group.count, 0)).toBe(
      result.runs.length,
    );
  });

  it('groups seeds so a run can be reopened from its outcome', () => {
    const result = campaign({ runs: 25 });
    for (const group of result.groups) {
      expect(group.seeds).toHaveLength(group.count);
      for (const seed of group.seeds) {
        expect(result.runs.find((run) => run.seed === seed)!.outcome).toBe(group.outcome);
      }
    }
  });

  it('reports empty outcomes by omitting them, in severity order', () => {
    const result = campaign({ runs: 30 });
    const order = result.groups.map((group) => OUTCOMES.indexOf(group.outcome));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(result.groups.every((group) => group.count > 0)).toBe(true);
  });

  it('cycles strategies so each gets the same number of attempts', () => {
    const result = campaign({ runs: 6, strategies: ['zero', 'boundary'] });
    expect(result.runs.map((run) => run.strategy)).toEqual([
      'zero',
      'boundary',
      'zero',
      'boundary',
      'zero',
      'boundary',
    ]);
  });

  it('honours the run cap', () => {
    expect(campaign({ runs: 5000 }).runs).toHaveLength(MAX_RUNS);
    expect(campaign({ runs: 0 }).runs).toHaveLength(1);
  });

  it('records a refusal rather than throwing when a mutation cannot apply', () => {
    const result = campaign({ runs: 3, strategies: ['truncate'], allowLengthChange: false });

    expect(result.runs.every((run) => run.outcome === 'refused')).toBe(true);
    expect(result.runs[0]!.summary).toMatch(/enable length-changing/);
    expect(result.runs[0]!.diagnosis).toBeUndefined();
  });

  it('finds a mix of outcomes across a realistic run of bit flips', () => {
    // The point of a campaign: most flips are harmless, a few are not, and
    // the grouping is what makes that ratio visible.
    const result = campaign({ runs: 60, startSeed: 1 });
    expect(result.groups.length).toBeGreaterThan(1);
    expect(result.runs.some((run) => run.outcome === 'decodes-cleanly')).toBe(true);
    expect(result.runs.some((run) => run.outcome !== 'decodes-cleanly')).toBe(true);
  });

  it('carries a diagnosis on every applied run, for reopening', () => {
    for (const run of campaign({ runs: 10 }).runs) {
      expect(run.diagnosis, `seed ${run.seed}`).toBeDefined();
      expect(run.mutationCount).toBeGreaterThan(0);
      expect(run.summary).not.toBe('');
    }
  });
});
