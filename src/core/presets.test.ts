import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../protocols/index';
import { newLayer, type FieldValue, type StackInstance } from './model';
import { serializeStack } from './serialize';
import { validateStack } from './validate';
import { readSpanValue } from './decode';
import { PRESETS, PRESET_GROUPS, presetStackLayers, type Preset } from './presets';

const registry = createBuiltinRegistry();

function stackOf(preset: Preset): StackInstance {
  return {
    layers: presetStackLayers(preset).map((layer) => ({
      ...newLayer(layer.protocolId),
      overrides: layer.overrides,
      pinned: layer.pinned,
    })),
    trailingPayload: preset.payload,
  };
}

const sameValue = (a: FieldValue, b: FieldValue): boolean =>
  a instanceof Uint8Array && b instanceof Uint8Array
    ? a.length === b.length && a.every((byte, i) => byte === b[i])
    : a === b;

describe('presets', () => {
  it('has unique names and known groups', () => {
    const names = PRESETS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    for (const preset of PRESETS) {
      expect(PRESET_GROUPS).toContain(preset.group);
      expect(preset.description.length).toBeGreaterThan(0);
    }
  });

  it.each(PRESETS.map((p) => [p.name, p] as const))(
    'serializes and validates "%s" without errors',
    (_name, preset) => {
      const stack = stackOf(preset);
      const packet = serializeStack(stack, registry);
      expect(packet.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
      const errors = validateStack(stack, registry, packet).filter((i) => i.severity === 'error');
      expect(errors).toEqual([]);
    },
  );

  it.each(PRESETS.filter((p) => p.layers.some((l) => l.overrides)).map((p) => [p.name, p] as const))(
    'realises the field overrides of "%s" in the serialized bytes',
    (_name, preset) => {
      const stack = stackOf(preset);
      const packet = serializeStack(stack, registry);
      preset.layers.forEach((layer, index) => {
        const def = registry.get(layer.protocolId)!;
        const uid = stack.layers[index]!.uid;
        for (const [fieldId, value] of Object.entries(layer.overrides ?? {})) {
          const field = def.fields.find((f) => f.id === fieldId);
          expect(field, `${layer.protocolId}.${fieldId} exists`).toBeDefined();
          // Non-computed overrides must land in the wire bytes verbatim.
          if (!field!.computed) {
            const span = packet.spans.find((s) => s.layerUid === uid && s.fieldId === fieldId)!;
            expect(sameValue(readSpanValue(packet.bytes, span, field!), value)).toBe(true);
          }
        }
        for (const fieldId of layer.pinned ?? []) {
          expect(def.fields.some((f) => f.id === fieldId)).toBe(true);
        }
      });
    },
  );
});
