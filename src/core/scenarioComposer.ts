import {
  newLayer,
  type FieldValue,
  type LayerInstance,
  type StackInstance,
} from './model';
import type { Registry } from './registry';
import type { PacketPlan } from './scenarios';
import { deriveTimeline, type Timeline } from './timeline';

export const COMPOSED_SCENARIO_VERSION = 1;

export interface ComposedScenarioStep {
  id: string;
  label: string;
  fromEndpoint: 0 | 1;
  toEndpoint: 0 | 1;
  /** Microseconds relative to the start of the exchange. */
  atUsec: number;
  stack: StackInstance;
}

export interface ComposedScenario {
  version: typeof COMPOSED_SCENARIO_VERSION;
  id: string;
  name: string;
  description: string;
  endpoints: [string, string];
  steps: ComposedScenarioStep[];
}

type WireValue =
  | number
  | string
  | { bytes: number[] }
  | { bigint: string };

interface WireScenario
  extends Omit<ComposedScenario, 'steps'> {
  steps: Array<
    Omit<ComposedScenarioStep, 'stack'> & {
      stack: {
        layers: Array<{
          protocolId: string;
          overrides: Record<string, WireValue>;
          pinned: string[];
        }>;
        trailingPayload: number[];
      };
    }
  >;
}

export function snapshotStack(stack: StackInstance): StackInstance {
  return {
    layers: stack.layers.map((layer) => ({
      ...newLayer(layer.protocolId),
      overrides: Object.fromEntries(
        Object.entries(layer.overrides).map(([fieldId, value]) => [
          fieldId,
          cloneValue(value),
        ]),
      ),
      pinned: [...layer.pinned],
    })),
    trailingPayload: new Uint8Array(stack.trailingPayload ?? []),
  };
}

export function createComposedScenario(stack: StackInstance): ComposedScenario {
  return {
    version: COMPOSED_SCENARIO_VERSION,
    id: `scenario-${Date.now().toString(36)}`,
    name: 'Custom exchange',
    description: 'A locally composed packet exchange.',
    endpoints: ['Endpoint A', 'Endpoint B'],
    steps: [
      {
        id: stepId(),
        label: 'packet 1',
        fromEndpoint: 0,
        toEndpoint: 1,
        atUsec: 0,
        stack: snapshotStack(stack),
      },
    ],
  };
}

export function duplicateComposedStep(
  step: ComposedScenarioStep,
  atUsec = step.atUsec + 10_000,
): ComposedScenarioStep {
  return {
    ...step,
    id: stepId(),
    label: `${step.label} copy`,
    atUsec,
    stack: snapshotStack(step.stack),
  };
}

export function composedPacketPlans(scenario: ComposedScenario): PacketPlan[] {
  return scenario.steps.map((step) => ({
    label: step.label,
    atUsec: step.atUsec,
    stack: snapshotStack(step.stack),
  }));
}

export function deriveComposedTimeline(
  scenario: ComposedScenario,
  registry: Registry,
): Timeline {
  const timeline = deriveTimeline(composedPacketPlans(scenario), registry);
  return {
    endpoints: [...scenario.endpoints],
    steps: timeline.steps.map((step, index) => {
      const composed = scenario.steps[index]!;
      return {
        ...step,
        src: scenario.endpoints[composed.fromEndpoint],
        dst: scenario.endpoints[composed.toEndpoint],
        fromEndpoint: composed.fromEndpoint,
        toEndpoint: composed.toEndpoint,
      };
    }),
  };
}

export function serializeComposedScenario(scenario: ComposedScenario): string {
  const wire: WireScenario = {
    ...scenario,
    steps: scenario.steps.map((step) => ({
      ...step,
      stack: {
        layers: step.stack.layers.map((layer) => ({
          protocolId: layer.protocolId,
          overrides: Object.fromEntries(
            Object.entries(layer.overrides).map(([fieldId, value]) => [
              fieldId,
              encodeValue(value),
            ]),
          ),
          pinned: [...layer.pinned],
        })),
        trailingPayload: [...(step.stack.trailingPayload ?? [])],
      },
    })),
  };
  return JSON.stringify(wire);
}

export function parseComposedScenario(json: string): ComposedScenario {
  const wire = JSON.parse(json) as WireScenario;
  if (
    wire.version !== COMPOSED_SCENARIO_VERSION ||
    typeof wire.id !== 'string' ||
    typeof wire.name !== 'string' ||
    typeof wire.description !== 'string' ||
    !Array.isArray(wire.endpoints) ||
    wire.endpoints.length !== 2 ||
    !wire.endpoints.every((endpoint) => typeof endpoint === 'string') ||
    !Array.isArray(wire.steps)
  ) {
    throw new Error('Unsupported or malformed composed scenario.');
  }
  const steps = wire.steps.map((step) => {
    if (
      typeof step.id !== 'string' ||
      typeof step.label !== 'string' ||
      ![0, 1].includes(step.fromEndpoint) ||
      ![0, 1].includes(step.toEndpoint) ||
      !Number.isSafeInteger(step.atUsec) ||
      step.atUsec < 0 ||
      !Array.isArray(step.stack?.layers) ||
      !Array.isArray(step.stack?.trailingPayload)
    ) {
      throw new Error('Unsupported or malformed composed scenario.');
    }
    const layers: LayerInstance[] = step.stack.layers.map((layer) => {
      if (
        typeof layer.protocolId !== 'string' ||
        !layer.overrides ||
        typeof layer.overrides !== 'object' ||
        !Array.isArray(layer.pinned)
      ) {
        throw new Error('Unsupported or malformed composed scenario.');
      }
      return {
        ...newLayer(layer.protocolId),
        overrides: Object.fromEntries(
          Object.entries(layer.overrides).map(([fieldId, value]) => [
            fieldId,
            decodeValue(value),
          ]),
        ),
        pinned: layer.pinned.filter((fieldId): fieldId is string => typeof fieldId === 'string'),
      };
    });
    return {
      id: step.id,
      label: step.label,
      fromEndpoint: step.fromEndpoint as 0 | 1,
      toEndpoint: step.toEndpoint as 0 | 1,
      atUsec: step.atUsec,
      stack: {
        layers,
        trailingPayload: Uint8Array.from(step.stack.trailingPayload),
      },
    };
  });
  return {
    version: COMPOSED_SCENARIO_VERSION,
    id: wire.id,
    name: wire.name,
    description: wire.description,
    endpoints: [wire.endpoints[0]!, wire.endpoints[1]!],
    steps,
  };
}

function encodeValue(value: FieldValue): WireValue {
  if (value instanceof Uint8Array) return { bytes: [...value] };
  if (typeof value === 'bigint') return { bigint: value.toString() };
  return value;
}

function decodeValue(value: WireValue): FieldValue {
  if (typeof value !== 'object') return value;
  if ('bytes' in value && Array.isArray(value.bytes)) return Uint8Array.from(value.bytes);
  if ('bigint' in value && typeof value.bigint === 'string') return BigInt(value.bigint);
  throw new Error('Unsupported composed scenario field value.');
}

function cloneValue(value: FieldValue): FieldValue {
  return value instanceof Uint8Array ? new Uint8Array(value) : value;
}

function stepId(): string {
  return `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
