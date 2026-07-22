import { describe, expect, it } from 'vitest';
import { newLayer, type LayerInstance, type StackInstance } from './model';
import { serializeStack } from './serialize';
import { validateStack } from './validate';
import { createBuiltinRegistry } from '../protocols';
import { applicableExperiments, type ExperimentApplication } from './experiments';

const registry = createBuiltinRegistry();

const stack = (ids: string[], payload?: string): StackInstance => ({
  layers: ids.map(newLayer),
  trailingPayload: payload ? new TextEncoder().encode(payload) : undefined,
});

const offered = (s: StackInstance) =>
  applicableExperiments(s, registry, serializeStack(s, registry));

/** Apply an experiment the way the UI does: pin its one field. */
function apply(s: StackInstance, app: ExperimentApplication): StackInstance {
  return {
    ...s,
    layers: s.layers.map((layer): LayerInstance =>
      layer.uid === app.layerUid
        ? {
            ...layer,
            overrides: { ...layer.overrides, [app.fieldId]: app.value },
            pinned: [...new Set([...layer.pinned, app.fieldId])],
          }
        : layer,
    ),
  };
}

const byId = (s: StackInstance, id: string) =>
  offered(s).find((e) => e.experimentId === id)!;

describe('applicableExperiments', () => {
  it('offers only experiments whose target fields exist in the packet', () => {
    const tcp = offered(stack(['ethernet', 'ipv4', 'tcp'])).map((e) => e.experimentId);
    expect(tcp).toEqual(
      expect.arrayContaining([
        'ipv4-checksum',
        'tcp-checksum',
        'ipv4-total-length',
        'ipv4-ihl',
        'tcp-data-offset',
        'selector-conflict',
      ]),
    );
    expect(tcp).not.toContain('udp-checksum');
    expect(tcp).not.toContain('udp-length');

    const udp = offered(stack(['ethernet', 'ipv4', 'udp', 'dns'])).map((e) => e.experimentId);
    expect(udp).toContain('udp-checksum');
    expect(udp).toContain('udp-length');
    expect(udp).not.toContain('tcp-checksum');
  });

  it('offers nothing when no target field is present', () => {
    // A lone link layer: no checksum/length fields and no following selector.
    expect(offered(stack(['ethernet']))).toEqual([]);
  });

  it('pins exactly one field and nothing else', () => {
    const s = stack(['ethernet', 'ipv4', 'tcp']);
    const app = byId(s, 'ipv4-checksum');
    const mutated = apply(s, app);
    // Only the targeted layer changed, and only by the one field.
    s.layers.forEach((layer, i) => {
      if (layer.uid === app.layerUid) {
        expect(Object.keys(mutated.layers[i]!.overrides)).toEqual([app.fieldId]);
      } else {
        expect(mutated.layers[i]).toBe(layer);
      }
    });
  });
});

describe('applied experiments produce the intended diagnostic', () => {
  const serializeWarnings = (s: StackInstance) =>
    serializeStack(s, registry).issues.filter((i) => i.severity === 'warning');

  it('a corrupted checksum warns and differs from the correct value', () => {
    const s = stack(['ethernet', 'ipv4', 'tcp']);
    const app = byId(s, 'tcp-checksum');
    const before = serializeStack(s, registry);
    const correct = before.spans.find(
      (sp) => sp.layerUid === app.layerUid && sp.fieldId === 'checksum',
    )!.value;
    expect(app.value).not.toBe(correct);
    expect(serializeWarnings(apply(s, app)).some((i) => /checksum/i.test(i.message))).toBe(true);
  });

  it('an overstated length warns', () => {
    const s = stack(['ethernet', 'ipv4', 'udp', 'dns']);
    const app = byId(s, 'udp-length');
    expect(serializeWarnings(apply(s, app)).some((i) => /length/i.test(i.message))).toBe(true);
  });

  it('an invalid IHL warns', () => {
    const s = stack(['ethernet', 'ipv4', 'tcp']);
    const app = byId(s, 'ipv4-ihl');
    expect(app.value).toBe(4);
    expect(serializeWarnings(apply(s, app)).length).toBeGreaterThan(0);
  });

  it('a conflicting selector raises a validation mismatch', () => {
    const s = stack(['ethernet', 'ipv4', 'tcp']);
    const app = byId(s, 'selector-conflict');
    const mutated = apply(s, app);
    const codes = validateStack(mutated, registry, serializeStack(mutated, registry)).map(
      (i) => i.code,
    );
    expect(codes).toContain('pinned-selector-mismatch');
  });

  it('a clean packet has no warnings before any experiment', () => {
    expect(serializeWarnings(stack(['ethernet', 'ipv4', 'tcp']))).toEqual([]);
  });
});
