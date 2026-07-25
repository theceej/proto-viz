import { describe, expect, it } from 'vitest';
import { newLayer } from './model';
import { createBuiltinRegistry } from '../protocols';
import {
  createComposedScenario,
  deriveComposedTimeline,
  duplicateComposedStep,
  parseComposedScenario,
  serializeComposedScenario,
} from './scenarioComposer';

const registry = createBuiltinRegistry();

describe('scenario composer documents', () => {
  it('round-trips versioned packet snapshots including byte and bigint values', () => {
    const stack = { layers: [newLayer('ethernet'), newLayer('ipv4')] };
    stack.layers[1]!.overrides.options = Uint8Array.from([1, 1, 1, 1]);
    stack.layers[1]!.overrides.identification = 12n;
    const scenario = createComposedScenario(stack);
    scenario.name = 'Saved lesson';

    const restored = parseComposedScenario(serializeComposedScenario(scenario));
    expect(restored.name).toBe('Saved lesson');
    expect(restored.steps[0]!.stack.layers[1]!.overrides.options).toEqual(
      Uint8Array.from([1, 1, 1, 1]),
    );
    expect(restored.steps[0]!.stack.layers[1]!.overrides.identification).toBe(12n);
  });

  it('preserves manual timing and endpoint direction in timeline previews', () => {
    const scenario = createComposedScenario({
      layers: [newLayer('ethernet'), newLayer('ipv4')],
    });
    scenario.endpoints = ['client', 'server'];
    scenario.steps[0]!.atUsec = 25_000;
    scenario.steps[0]!.fromEndpoint = 1;
    scenario.steps[0]!.toEndpoint = 0;
    scenario.steps.push(duplicateComposedStep(scenario.steps[0]!, 80_000));

    const timeline = deriveComposedTimeline(scenario, registry);
    expect(timeline.endpoints).toEqual(['client', 'server']);
    expect(timeline.steps.map((step) => step.atUsec)).toEqual([25_000, 80_000]);
    expect(timeline.steps[0]).toMatchObject({
      src: 'server',
      dst: 'client',
      fromEndpoint: 1,
      toEndpoint: 0,
    });
  });

  it('rejects unsupported or malformed saved documents', () => {
    expect(() => parseComposedScenario('{"version":99}')).toThrow(
      'Unsupported or malformed',
    );
    const scenario = JSON.parse(
      serializeComposedScenario(
        createComposedScenario({ layers: [newLayer('ethernet')] }),
      ),
    );
    scenario.steps[0].atUsec = -1;
    expect(() => parseComposedScenario(JSON.stringify(scenario))).toThrow(
      'Unsupported or malformed',
    );
  });
});
