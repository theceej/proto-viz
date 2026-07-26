import { describe, expect, it } from 'vitest';
import { newLayer, type ProtocolDefinition, type StackInstance } from '../core/model';
import type { ComposedScenario } from '../core/scenarioComposer';
import { serializeStack } from '../core/serialize';
import { createBuiltinRegistry } from '../protocols';
import type { ComparisonPacket } from './comparisonStore';
import type { SavedStack } from './persistence';
import {
  WorkspaceJsonError,
  exportWorkspaceJson,
  parseWorkspaceJson,
  planWorkspaceImport,
  type WorkspaceExportData,
  type WorkspaceLocalSnapshot,
} from './workspaceJson';

const custom: ProtocolDefinition = {
  id: 'workspace-custom',
  name: 'Workspace custom',
  layerHint: 'application',
  source: 'custom',
  fields: [
    { id: 'wide', name: 'Wide', type: 'uint', bitLength: 64, default: 0x0102030405060708n },
    { id: 'blob', name: 'Blob', type: 'bytes', bitLength: 'auto', default: Uint8Array.of(9, 8) },
  ],
  providesNamespaces: [],
  encapsulations: [],
};

const stack: StackInstance = {
  layers: [{ uid: 'custom-layer', protocolId: custom.id, overrides: { wide: 5n, blob: Uint8Array.of(1, 2, 3) }, pinned: [] }],
  trailingPayload: Uint8Array.of(4, 5),
};

const saved: SavedStack = {
  id: 'saved-1',
  name: 'Saved one',
  savedAt: 123,
  layers: stack.layers.map(({ protocolId, overrides, pinned }) => ({ protocolId, overrides, pinned })),
  trailingPayload: Uint8Array.of(4, 5),
};

const scenario: ComposedScenario = {
  version: 1,
  id: 'scenario-1',
  name: 'Exchange',
  description: 'Test exchange',
  endpoints: ['A', 'B'],
  steps: [{ id: 'step-1', label: 'request', fromEndpoint: 0, toEndpoint: 1, atUsec: 10, stack }],
};

const registry = createBuiltinRegistry([custom]);
const packet = serializeStack(stack, registry);
const comparison: ComparisonPacket = { id: 7, label: 'snapshot', packet };

const data: WorkspaceExportData = {
  customProtocols: [custom],
  savedStacks: [saved],
  currentStack: stack,
  comparisons: [comparison],
  composedScenario: scenario,
};

const local = (): WorkspaceLocalSnapshot => ({
  customProtocols: [],
  savedStacks: [],
  currentStack: { layers: [], trailingPayload: new Uint8Array() },
  comparisons: [],
  composedScenario: null,
});

function fullJson(): string {
  return exportWorkspaceJson(data, {
    customProtocols: true,
    savedStacks: true,
    currentStack: true,
    comparisons: true,
    composedScenario: true,
  }, '2026-07-26T00:00:00.000Z');
}

function errorCode(fn: () => unknown): string | undefined {
  try { fn(); } catch (error) { return error instanceof WorkspaceJsonError ? error.code : undefined; }
  return undefined;
}

describe('workspace JSON', () => {
  it('round-trips every section, bytes, bigints, and expected serialized bytes', () => {
    const parsed = parseWorkspaceJson(fullJson());
    expect(parsed.exportedAt).toBe('2026-07-26T00:00:00.000Z');
    expect(parsed.customProtocols?.[0]?.fields[0]?.default).toBe(0x0102030405060708n);
    expect(parsed.customProtocols?.[0]?.fields[1]?.default).toEqual(Uint8Array.of(9, 8));
    expect(parsed.savedStacks?.[0]?.layers[0]?.overrides.wide).toBe(5n);
    expect(parsed.currentStack?.stack.trailingPayload).toEqual(Uint8Array.of(4, 5));
    expect(parsed.composedScenario?.scenario.steps[0]?.stack.layers[0]?.overrides.blob).toEqual(Uint8Array.of(1, 2, 3));
    expect(parsed.savedStacks?.[0]?.expectedBytes).toEqual(packet.bytes);
    expect(parsed.composedScenario?.expectedBytesByStep['step-1']).toEqual(packet.bytes);
  });

  it('automatically includes custom protocols referenced by selected stacks', () => {
    const parsed = parseWorkspaceJson(exportWorkspaceJson(data, { savedStacks: ['saved-1'] }));
    expect(parsed.customProtocols?.map((definition) => definition.id)).toEqual([custom.id]);
    expect(parsed.savedStacks).toHaveLength(1);
  });

  it('preserves packet metadata needed by comparison views and safely omits traces', () => {
    const parsed = parseWorkspaceJson(fullJson());
    const restored = parsed.comparisons?.[0]?.packet;
    expect(restored?.bytes).toEqual(packet.bytes);
    expect(restored?.payloadOffset).toBe(packet.payloadOffset);
    expect(restored?.layers).toEqual(packet.layers);
    expect(restored?.spans.map((span) => ({ ...span, calculation: undefined }))).toEqual(
      packet.spans.map((span) => ({ ...span, calculation: undefined })),
    );
    expect(restored?.issues).toEqual(packet.issues);
  });

  it('builds merge plans with keep, overwrite, and copy conflicts without mutation', () => {
    const incoming = parseWorkspaceJson(fullJson());
    const existing = local();
    existing.customProtocols = [{ ...custom, name: 'Local name' }];
    existing.savedStacks = [{ ...saved, name: 'Local stack' }];
    const before = structuredClone(existing);

    const keep = planWorkspaceImport(incoming, existing, {
      customProtocols: { mode: 'merge', conflict: 'keep' },
      savedStacks: { mode: 'merge', conflict: 'keep' },
    });
    expect(keep.ok).toBe(true);
    expect(keep.prospective.customProtocols[0]?.name).toBe('Local name');
    expect(keep.prospective.savedStacks[0]?.name).toBe('Local stack');
    expect(keep.conflicts.map((item) => item.code)).toEqual(expect.arrayContaining(['PROTOCOL_ID_CONFLICT', 'STACK_ID_CONFLICT']));

    const overwrite = planWorkspaceImport(incoming, existing, {
      customProtocols: { mode: 'merge', conflict: 'overwrite' },
      savedStacks: { mode: 'merge', conflict: 'copy' },
    });
    expect(overwrite.prospective.customProtocols[0]?.name).toBe(custom.name);
    expect(overwrite.prospective.savedStacks).toHaveLength(2);
    expect(overwrite.prospective.savedStacks[1]?.id).toMatch(/^saved-1-copy/);
    expect(existing).toEqual(before);
  });

  it('supports replace, explicit empty clears, and absent-section preservation', () => {
    const existing = local();
    existing.customProtocols = [custom];
    existing.savedStacks = [saved];
    existing.composedScenario = scenario;
    const empty = parseWorkspaceJson(JSON.stringify({
      app: 'proto-viz', kind: 'workspace', version: 1,
      exportedAt: '2026-07-26T00:00:00.000Z', customProtocols: [], savedStacks: [], composedScenario: null,
    }));
    const plan = planWorkspaceImport(empty, existing, {
      customProtocols: { mode: 'replace' }, savedStacks: { mode: 'replace' }, composedScenario: 'replace',
    });
    expect(plan.prospective.customProtocols).toEqual([]);
    expect(plan.prospective.savedStacks).toEqual([]);
    expect(plan.prospective.composedScenario).toBeNull();
    expect(plan.prospective.currentStack.layers).toEqual(existing.currentStack.layers);
  });

  it('blocks protocol replacement that would orphan retained local data', () => {
    const existing = local();
    existing.customProtocols = [custom];
    existing.savedStacks = [saved];
    const incoming = parseWorkspaceJson(JSON.stringify({
      app: 'proto-viz', kind: 'workspace', version: 1,
      exportedAt: '2026-07-26T00:00:00.000Z', customProtocols: [],
    }));
    const plan = planWorkspaceImport(incoming, existing, {
      customProtocols: { mode: 'replace' },
    });
    expect(plan.ok).toBe(false);
    expect(plan.errors).toContainEqual(expect.objectContaining({ code: 'UNKNOWN_PROTOCOL' }));
  });

  it('detects byte drift against the prospective registry', () => {
    const raw = JSON.parse(fullJson());
    raw.currentStack.expectedBytes = { $bytes: 'AA==' };
    const plan = planWorkspaceImport(parseWorkspaceJson(JSON.stringify(raw)), local(), {
      customProtocols: { mode: 'replace' },
    });
    expect(plan.ok).toBe(false);
    expect(plan.errors[0]?.code).toBe('EXPECTED_BYTES_MISMATCH');
  });

  it('rejects unknown stack fields and comparison protocol metadata during planning', () => {
    const stackRaw = JSON.parse(fullJson());
    stackRaw.currentStack.layers[0].overrides.missing = 1;
    const stackPlan = planWorkspaceImport(parseWorkspaceJson(JSON.stringify(stackRaw)), local(), {
      customProtocols: { mode: 'replace' },
    });
    expect(stackPlan.errors).toContainEqual(expect.objectContaining({ code: 'UNKNOWN_FIELD' }));

    const comparisonRaw = JSON.parse(fullJson());
    comparisonRaw.comparisons[0].packet.layers[0].protocolId = 'missing-protocol';
    const comparisonPlan = planWorkspaceImport(parseWorkspaceJson(JSON.stringify(comparisonRaw)), local(), {
      customProtocols: { mode: 'replace' },
    });
    expect(comparisonPlan.errors).toContainEqual(expect.objectContaining({ code: 'UNKNOWN_PROTOCOL' }));
  });

  it('rejects protocol defaults and expressions that do not match their schema', () => {
    const wrongDefault = JSON.parse(fullJson());
    wrongDefault.customProtocols[0].fields[0].default = 'not-an-integer';
    expect(errorCode(() => parseWorkspaceJson(JSON.stringify(wrongDefault)))).toBe('INVALID_FIELD_VALUE');

    const unknownField = JSON.parse(fullJson());
    unknownField.customProtocols[0].fields[0].presentIf = { kind: 'field', fieldId: 'missing' };
    expect(errorCode(() => parseWorkspaceJson(JSON.stringify(unknownField)))).toBe('INVALID_SCHEMA');
  });

  it('rejects byte-matching stacks with malformed typed values', () => {
    const ipv4 = newLayer('ipv4');
    ipv4.overrides.src = 'not-an-address';
    const invalidStack = { layers: [ipv4], trailingPayload: new Uint8Array() };
    const text = exportWorkspaceJson({
      customProtocols: [], savedStacks: [], currentStack: invalidStack,
      comparisons: [], composedScenario: null,
    }, { currentStack: true });
    const plan = planWorkspaceImport(parseWorkspaceJson(text), local());
    expect(plan.ok).toBe(false);
    expect(plan.errors).toContainEqual(expect.objectContaining({ code: 'INVALID_FIELD_VALUE' }));
  });

  it('migrates version 1 protocol-library JSON with a warning', () => {
    const protocol = JSON.parse(fullJson()).customProtocols[0];
    const parsed = parseWorkspaceJson(JSON.stringify({ app: 'proto-viz', version: 1, protocols: [protocol] }));
    expect(parsed.customProtocols?.[0]?.id).toBe(custom.id);
    expect(parsed.savedStacks).toBeUndefined();
    expect(parsed.warnings[0]?.code).toBe('MIGRATED_LIBRARY_V1');
  });

  it('warns for unknown sections and rejects future versions clearly', () => {
    const base = { app: 'proto-viz', kind: 'workspace', exportedAt: '2026-07-26T00:00:00.000Z' };
    expect(parseWorkspaceJson(JSON.stringify({ ...base, version: 1, futureSection: {} })).warnings[0]?.code).toBe('UNKNOWN_SECTION');
    expect(() => parseWorkspaceJson(JSON.stringify({ ...base, version: 2 }))).toThrow('newer than supported version 1');
    expect(errorCode(() => parseWorkspaceJson(JSON.stringify({ ...base, version: 2 })))).toBe('FUTURE_VERSION');
  });

  it('rejects malformed tags, base64, schemas, duplicate IDs, and built-in collisions', () => {
    const raw = JSON.parse(fullJson());
    raw.currentStack.layers[0].overrides.wide = { $bigint: '1', extra: true };
    expect(errorCode(() => parseWorkspaceJson(JSON.stringify(raw)))).toBe('MALFORMED_TAG');

    const badBase64 = JSON.parse(fullJson());
    badBase64.currentStack.trailingPayload = { $bytes: '***' };
    expect(errorCode(() => parseWorkspaceJson(JSON.stringify(badBase64)))).toBe('INVALID_BASE64');

    const duplicate = JSON.parse(fullJson());
    duplicate.savedStacks.push(duplicate.savedStacks[0]);
    expect(errorCode(() => parseWorkspaceJson(JSON.stringify(duplicate)))).toBe('DUPLICATE_STACK_ID');

    const collision = JSON.parse(fullJson());
    collision.customProtocols[0].id = 'ipv4';
    expect(errorCode(() => parseWorkspaceJson(JSON.stringify(collision)))).toBe('BUILTIN_ID_COLLISION');
  });

  it('enforces text, layer, protocol, step, span, and binary caps', () => {
    expect(errorCode(() => parseWorkspaceJson(' '.repeat(10 * 1024 * 1024 + 1)))).toBe('TEXT_TOO_LARGE');
    const raw = JSON.parse(fullJson());
    raw.currentStack.layers = Array.from({ length: 65 }, () => raw.currentStack.layers[0]);
    expect(errorCode(() => parseWorkspaceJson(JSON.stringify(raw)))).toBe('ARRAY_LIMIT');

    const tooManyProtocols = { app: 'proto-viz', kind: 'workspace', version: 1, exportedAt: '2026-07-26T00:00:00.000Z', customProtocols: Array.from({ length: 501 }, () => ({})) };
    expect(errorCode(() => parseWorkspaceJson(JSON.stringify(tooManyProtocols)))).toBe('ARRAY_LIMIT');

    const oversizedPacket = JSON.parse(fullJson());
    oversizedPacket.comparisons[0].packet.bytes = { $bytes: btoa('\0'.repeat(256 * 1024 + 1)) };
    expect(errorCode(() => parseWorkspaceJson(JSON.stringify(oversizedPacket)))).toBe('BINARY_ITEM_LIMIT');
  });
});
