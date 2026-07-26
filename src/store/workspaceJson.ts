import type {
  Expr,
  FieldDef,
  FieldValue,
  LayerInstance,
  ProtocolDefinition,
  StackInstance,
} from '../core/model';
import { newLayer } from '../core/model';
import type { ComposedScenario } from '../core/scenarioComposer';
import { serializeStack } from '../core/serialize';
import { valueToBytes, valueToNumber } from '../core/values';
import { createBuiltinRegistry } from '../protocols';
import type { ComparisonPacket } from './comparisonStore';
import type { SavedStack } from './persistence';

export const WORKSPACE_APP = 'proto-viz';
export const WORKSPACE_KIND = 'workspace';
export const WORKSPACE_VERSION = 1;

const MAX_TEXT = 10 * 1024 * 1024;
const MAX_BINARY = 8 * 1024 * 1024;
const MAX_PROTOCOLS = 500;
const MAX_STACKS = 2000;
const MAX_LAYERS = 64;
const MAX_FIELDS = 1024;
const MAX_PACKET = 256 * 1024;
const MAX_STEPS = 1000;
const MAX_EXPR_DEPTH = 32;
const MAX_EXPR_NODES = 1024;
const MAX_STRING = 256 * 1024;
const MAX_COMPARISON_PACKET = 16 * 1024;
const MAX_SPANS = 4096;

type JsonObject = Record<string, unknown>;
type WireValue = number | string | { $bytes: string } | { $bigint: string };
type StackLike = {
  layers: Array<Pick<LayerInstance, 'uid' | 'protocolId' | 'overrides' | 'pinned'> | Pick<LayerInstance, 'protocolId' | 'overrides' | 'pinned'>>;
  trailingPayload?: Uint8Array;
};

export interface WorkspaceSavedStack extends SavedStack {
  expectedBytes: Uint8Array;
}

export interface WorkspaceStack {
  stack: StackInstance;
  expectedBytes: Uint8Array;
}

export interface WorkspaceComposedScenario {
  scenario: ComposedScenario;
  expectedBytesByStep: Record<string, Uint8Array>;
}

export interface WorkspaceSections {
  customProtocols?: ProtocolDefinition[];
  savedStacks?: WorkspaceSavedStack[];
  currentStack?: WorkspaceStack;
  comparisons?: ComparisonPacket[];
  composedScenario?: WorkspaceComposedScenario | null;
}

export interface ParsedWorkspace extends WorkspaceSections {
  exportedAt: string;
  warnings: WorkspaceDiagnostic[];
}

export interface WorkspaceDiagnostic {
  code: string;
  message: string;
  path?: string;
}

export class WorkspaceJsonError extends Error {
  readonly code: string;
  readonly path?: string;

  constructor(code: string, message: string, path?: string) {
    super(message);
    this.name = 'WorkspaceJsonError';
    this.code = code;
    this.path = path;
  }
}

export interface WorkspaceExportData {
  customProtocols: ProtocolDefinition[];
  savedStacks: SavedStack[];
  currentStack: StackInstance;
  comparisons: ComparisonPacket[];
  composedScenario?: ComposedScenario | null;
}

export interface WorkspaceExportSelection {
  customProtocols?: boolean | string[];
  savedStacks?: boolean | string[];
  currentStack?: boolean;
  comparisons?: boolean;
  composedScenario?: boolean;
}

export interface WorkspaceLocalSnapshot {
  customProtocols: ProtocolDefinition[];
  savedStacks: SavedStack[];
  currentStack: StackInstance;
  comparisons: ComparisonPacket[];
  composedScenario: ComposedScenario | null;
}

export interface WorkspaceImportChoices {
  customProtocols?: { mode: 'merge' | 'replace'; conflict?: 'keep' | 'overwrite' };
  savedStacks?: { mode: 'merge' | 'replace'; conflict?: 'keep' | 'overwrite' | 'copy' };
  comparisons?: { mode: 'merge' | 'replace' };
  currentStack?: 'keep' | 'replace';
  composedScenario?: 'keep' | 'replace';
}

export interface WorkspacePlanCounts {
  protocols: number;
  stacks: number;
  comparisons: number;
  currentStack: number;
  composedScenario: number;
}

export interface WorkspaceImportPlan {
  ok: boolean;
  counts: WorkspacePlanCounts;
  conflicts: WorkspaceDiagnostic[];
  errors: WorkspaceDiagnostic[];
  changedSections: Array<keyof WorkspaceSections>;
  prospective: WorkspaceLocalSnapshot;
}

export function exportWorkspaceJson(
  data: WorkspaceExportData,
  selection: WorkspaceExportSelection,
  exportedAt = new Date().toISOString(),
): string {
  const selectedStacks = selectById(data.savedStacks, selection.savedStacks);
  const includeCurrent = selection.currentStack === true;
  const includeComparisons = selection.comparisons === true;
  const includeScenario = selection.composedScenario === true && data.composedScenario != null;
  const referenced = new Set<string>();
  for (const saved of selectedStacks) addStackProtocols(saved, referenced);
  if (includeCurrent) addStackProtocols(data.currentStack, referenced);
  if (includeComparisons) for (const item of data.comparisons) for (const layer of item.packet.layers) referenced.add(layer.protocolId);
  if (includeScenario) for (const step of data.composedScenario!.steps) addStackProtocols(step.stack, referenced);

  const explicitlySelected = selection.customProtocols === true
    ? new Set(data.customProtocols.map((item) => item.id))
    : new Set(Array.isArray(selection.customProtocols) ? selection.customProtocols : []);
  const customProtocols = data.customProtocols.filter(
    (definition) => explicitlySelected.has(definition.id) || referenced.has(definition.id),
  );
  const registry = createBuiltinRegistry(customProtocols);
  const envelope: JsonObject = {
    app: WORKSPACE_APP,
    kind: WORKSPACE_KIND,
    version: WORKSPACE_VERSION,
    exportedAt,
  };
  if (selection.customProtocols === true || Array.isArray(selection.customProtocols) || customProtocols.length > 0) {
    envelope.customProtocols = customProtocols.map(encodeProtocol);
  }
  if (selection.savedStacks === true || Array.isArray(selection.savedStacks)) {
    envelope.savedStacks = selectedStacks.map((saved, index) => ({
      id: saved.id,
      name: saved.name,
      savedAt: saved.savedAt,
      ...encodeStack(saved),
      expectedBytes: encodeBytes(serializeStack(runtimeStack(saved, `saved-${index}`), registry).bytes),
    }));
  }
  if (includeCurrent) {
    envelope.currentStack = {
      ...encodeStack(data.currentStack),
      expectedBytes: encodeBytes(serializeStack(data.currentStack, registry).bytes),
    };
  }
  if (includeComparisons) {
    envelope.comparisons = data.comparisons.map(encodeComparison);
  }
  if (selection.composedScenario === true) {
    envelope.composedScenario = data.composedScenario == null ? null : encodeScenario(data.composedScenario, registry);
  }
  const text = JSON.stringify(envelope, null, 2);
  // Apply the same caps and schema checks to our own output so an oversized or
  // internally inconsistent browser snapshot cannot create an unusable backup.
  parseWorkspaceJson(text);
  return text;
}

export function parseWorkspaceJson(text: string): ParsedWorkspace {
  if (text.length > MAX_TEXT || new TextEncoder().encode(text).byteLength > MAX_TEXT) fail('TEXT_TOO_LARGE', `Workspace text exceeds the ${MAX_TEXT} byte limit.`);
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    fail('INVALID_JSON', 'Workspace file is not valid JSON.');
  }
  const object = obj(root, '$');
  if (object.app !== WORKSPACE_APP) fail('INVALID_APP', 'Not a proto-viz workspace file.', '$.app');

  if (object.kind === undefined && object.version === 1 && Array.isArray(object.protocols)) {
    const budget = { bytes: 0 };
    const protocols = parseProtocols(object.protocols, '$.protocols', budget);
    return {
      exportedAt: new Date(0).toISOString(),
      customProtocols: protocols,
      warnings: [{ code: 'MIGRATED_LIBRARY_V1', message: 'Imported a version 1 protocol library as a custom-protocol-only workspace.' }],
    };
  }
  if (object.kind !== WORKSPACE_KIND) fail('INVALID_KIND', 'Not a proto-viz workspace file.', '$.kind');
  const version = integer(object.version, '$.version', 0);
  if (version > WORKSPACE_VERSION) {
    fail('FUTURE_VERSION', `Workspace version ${version} is newer than supported version ${WORKSPACE_VERSION}.`, '$.version');
  }
  if (version !== WORKSPACE_VERSION) fail('UNSUPPORTED_VERSION', `Unsupported workspace version ${version}.`, '$.version');
  const exportedAt = string(object.exportedAt, '$.exportedAt');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(exportedAt) || new Date(exportedAt).toISOString() !== exportedAt) {
    fail('INVALID_DATE', 'Workspace exportedAt must be an ISO date.', '$.exportedAt');
  }
  const known = new Set(['app', 'kind', 'version', 'exportedAt', 'customProtocols', 'savedStacks', 'currentStack', 'comparisons', 'composedScenario']);
  const warnings = Object.keys(object)
    .filter((key) => !known.has(key))
    .map((key) => ({ code: 'UNKNOWN_SECTION', message: `Ignored unknown workspace section "${key}".`, path: `$.${key}` }));
  const budget = { bytes: 0 };
  const result: ParsedWorkspace = { exportedAt, warnings };
  if ('customProtocols' in object) result.customProtocols = parseProtocols(array(object.customProtocols, '$.customProtocols', MAX_PROTOCOLS), '$.customProtocols', budget);
  if ('savedStacks' in object) {
    const entries = array(object.savedStacks, '$.savedStacks', MAX_STACKS);
    result.savedStacks = entries.map((entry, index) => parseSavedStack(entry, `$.savedStacks[${index}]`, budget));
    rejectDuplicate(result.savedStacks.map((item) => item.id), '$.savedStacks', 'DUPLICATE_STACK_ID');
  }
  if ('currentStack' in object) result.currentStack = parseWorkspaceStack(object.currentStack, '$.currentStack', budget);
  if ('comparisons' in object) {
    result.comparisons = array(object.comparisons, '$.comparisons', 2).map((entry, index) => parseComparison(entry, `$.comparisons[${index}]`, budget));
    rejectDuplicate(result.comparisons.map((item) => String(item.id)), '$.comparisons', 'DUPLICATE_COMPARISON_ID');
  }
  if ('composedScenario' in object) result.composedScenario = object.composedScenario === null ? null : parseScenario(object.composedScenario, '$.composedScenario', budget);
  return result;
}

export function planWorkspaceImport(
  incoming: ParsedWorkspace,
  local: WorkspaceLocalSnapshot,
  choices: WorkspaceImportChoices = {},
): WorkspaceImportPlan {
  const prospective = cloneLocal(local);
  const conflicts: WorkspaceDiagnostic[] = [];
  const errors: WorkspaceDiagnostic[] = [];
  const changedSections: Array<keyof WorkspaceSections> = [];
  const counts: WorkspacePlanCounts = { protocols: 0, stacks: 0, comparisons: 0, currentStack: 0, composedScenario: 0 };

  if (incoming.customProtocols !== undefined) {
    const choice = choices.customProtocols ?? { mode: 'merge' as const, conflict: 'keep' as const };
    const merged = choice.mode === 'replace' ? [] : cloneProtocols(local.customProtocols);
    for (const definition of incoming.customProtocols) {
      const index = merged.findIndex((item) => item.id === definition.id);
      if (index >= 0) {
        conflicts.push({ code: 'PROTOCOL_ID_CONFLICT', message: `Custom protocol "${definition.id}" already exists.`, path: definition.id });
        if (choice.conflict === 'overwrite') merged[index] = cloneProtocol(definition);
      } else merged.push(cloneProtocol(definition));
    }
    prospective.customProtocols = merged;
    counts.protocols = incoming.customProtocols.length;
    changedSections.push('customProtocols');
  }

  const registry = createBuiltinRegistry(prospective.customProtocols);
  if (incoming.savedStacks !== undefined) {
    const choice = choices.savedStacks ?? { mode: 'merge' as const, conflict: 'keep' as const };
    const merged = choice.mode === 'replace' ? [] : cloneSaved(local.savedStacks);
    incoming.savedStacks.forEach((saved, importedIndex) => {
      verifyStack(saved, saved.expectedBytes, registry, `savedStacks.${saved.id}`, errors);
      const index = merged.findIndex((item) => item.id === saved.id);
      const clean = cleanSaved(saved);
      if (index < 0) merged.push(clean);
      else {
        conflicts.push({ code: 'STACK_ID_CONFLICT', message: `Saved stack "${saved.id}" already exists.`, path: saved.id });
        if (choice.conflict === 'overwrite') merged[index] = clean;
        if (choice.conflict === 'copy') merged.push({ ...clean, id: uniqueCopyId(saved.id, merged, importedIndex) });
      }
    });
    prospective.savedStacks = merged;
    counts.stacks = incoming.savedStacks.length;
    changedSections.push('savedStacks');
  }
  if (incoming.currentStack !== undefined) {
    verifyStack(incoming.currentStack.stack, incoming.currentStack.expectedBytes, registry, 'currentStack', errors);
    if ((choices.currentStack ?? 'replace') === 'replace') prospective.currentStack = cloneStack(incoming.currentStack.stack);
    else conflicts.push({ code: 'CURRENT_STACK_KEPT', message: 'Kept the local current stack.' });
    counts.currentStack = 1;
    changedSections.push('currentStack');
  }
  if (incoming.composedScenario !== undefined) {
    if (incoming.composedScenario !== null) for (const step of incoming.composedScenario.scenario.steps) {
      verifyStack(step.stack, incoming.composedScenario.expectedBytesByStep[step.id]!, registry, `composedScenario.steps.${step.id}`, errors);
    }
    if ((choices.composedScenario ?? 'replace') === 'replace') prospective.composedScenario = incoming.composedScenario === null ? null : cloneScenario(incoming.composedScenario.scenario);
    else conflicts.push({ code: 'COMPOSED_SCENARIO_KEPT', message: 'Kept the local composed scenario.' });
    counts.composedScenario = 1;
    changedSections.push('composedScenario');
  }
  if (incoming.comparisons !== undefined) {
    for (const [index, comparison] of incoming.comparisons.entries()) {
      validateComparisonProtocols(comparison, registry, `comparisons.${index}`, errors);
    }
    const mode = choices.comparisons?.mode ?? 'merge';
    prospective.comparisons = mode === 'replace'
      ? incoming.comparisons.map(cloneComparison).slice(0, 2)
      : [...local.comparisons.map(cloneComparison), ...incoming.comparisons.map(cloneComparison)].slice(-2);
    counts.comparisons = incoming.comparisons.length;
    changedSections.push('comparisons');
  }
  validateProspectiveWorkspace(prospective, registry, errors);
  return { ok: errors.length === 0, counts, conflicts, errors, changedSections, prospective };
}

function encodeProtocol(definition: ProtocolDefinition): unknown {
  return {
    ...definition,
    source: 'custom',
    fields: definition.fields.map((field) => ({
      ...field,
      ...(field.default === undefined ? {} : { default: encodeValue(field.default) }),
    })),
  };
}

function encodeStack(stack: StackLike): JsonObject {
  return {
    layers: stack.layers.map((layer) => ({
      protocolId: layer.protocolId,
      overrides: Object.fromEntries(Object.entries(layer.overrides).map(([key, value]) => [key, encodeValue(value)])),
      pinned: [...layer.pinned],
    })),
    trailingPayload: encodeBytes(stack.trailingPayload ?? new Uint8Array()),
  };
}

function encodeScenario(scenario: ComposedScenario, registry: ReturnType<typeof createBuiltinRegistry>): unknown {
  return {
    version: scenario.version,
    id: scenario.id,
    name: scenario.name,
    description: scenario.description,
    endpoints: scenario.endpoints,
    steps: scenario.steps.map((step) => ({
      id: step.id,
      label: step.label,
      fromEndpoint: step.fromEndpoint,
      toEndpoint: step.toEndpoint,
      atUsec: step.atUsec,
      stack: encodeStack(step.stack),
      expectedBytes: encodeBytes(serializeStack(step.stack, registry).bytes),
    })),
  };
}

function encodeComparison(item: ComparisonPacket): unknown {
  return {
    id: item.id,
    label: item.label,
    packet: {
      bytes: encodeBytes(item.packet.bytes),
      payloadOffset: item.packet.payloadOffset,
      layers: item.packet.layers,
      issues: item.packet.issues,
      spans: item.packet.spans.map((span) => ({
        layerUid: span.layerUid,
        fieldId: span.fieldId,
        bitOffset: span.bitOffset,
        bitLength: span.bitLength,
        value: encodeValue(span.value),
        computed: span.computed,
        pinned: span.pinned,
      })),
    },
  };
}

function parseProtocols(input: unknown[], path: string, budget: { bytes: number }): ProtocolDefinition[] {
  const protocols = input.map((entry, index) => parseProtocol(entry, `${path}[${index}]`, budget));
  rejectDuplicate(protocols.map((item) => item.id), path, 'DUPLICATE_PROTOCOL_ID');
  const builtinIds = new Set(createBuiltinRegistry().all().map((item) => item.id));
  for (const definition of protocols) {
    if (builtinIds.has(definition.id)) fail('BUILTIN_ID_COLLISION', `Custom protocol "${definition.id}" collides with a built-in protocol ID.`, `${path}.${definition.id}`);
  }
  return protocols;
}

function parseProtocol(input: unknown, path: string, budget: { bytes: number }): ProtocolDefinition {
  const value = obj(input, path);
  const fields = array(value.fields, `${path}.fields`, MAX_FIELDS).map((field, index) => parseField(field, `${path}.fields[${index}]`, budget));
  rejectDuplicate(fields.map((field) => field.id), `${path}.fields`, 'DUPLICATE_FIELD_ID');
  const layerHint = string(value.layerHint, `${path}.layerHint`);
  if (!['link', 'network', 'transport', 'application', 'tunnel'].includes(layerHint)) fail('INVALID_SCHEMA', 'Invalid protocol layerHint.', `${path}.layerHint`);
  const providesNamespaces = array(value.providesNamespaces, `${path}.providesNamespaces`, MAX_FIELDS).map((entry, index) => {
    const item = obj(entry, `${path}.providesNamespaces[${index}]`);
    return { id: shortString(item.id, `${path}.providesNamespaces[${index}].id`), displayName: shortString(item.displayName, `${path}.providesNamespaces[${index}].displayName`), selectorFieldId: item.selectorFieldId === null ? null : shortString(item.selectorFieldId, `${path}.providesNamespaces[${index}].selectorFieldId`) };
  });
  const encapsulations = array(value.encapsulations, `${path}.encapsulations`, MAX_FIELDS).map((entry, index) => {
    const item = obj(entry, `${path}.encapsulations[${index}]`);
    return { namespaceId: shortString(item.namespaceId, `${path}.encapsulations[${index}].namespaceId`), ...(item.value === undefined ? {} : { value: integer(item.value, `${path}.encapsulations[${index}].value`, 0) }), ...(item.conventional === undefined ? {} : { conventional: bool(item.conventional, `${path}.encapsulations[${index}].conventional`) }) };
  });
  const definition: ProtocolDefinition = {
    id: shortString(value.id, `${path}.id`, false),
    name: shortString(value.name, `${path}.name`),
    layerHint: layerHint as ProtocolDefinition['layerHint'],
    fields,
    providesNamespaces,
    encapsulations,
    source: 'custom',
  };
  for (const key of ['fullName', 'description', 'notes'] as const) if (value[key] !== undefined) definition[key] = string(value[key], `${path}.${key}`);
  if (value.references !== undefined) definition.references = array(value.references, `${path}.references`, 128).map((item, index) => shortString(item, `${path}.references[${index}]`));
  if (value.lintRules !== undefined) definition.lintRules = parseLintRules(value.lintRules, `${path}.lintRules`, new Set(fields.map((field) => field.id)));
  validateProtocolRelationships(definition, path);
  return definition;
}

function parseField(input: unknown, path: string, budget: { bytes: number }): FieldDef {
  const value = obj(input, path);
  const type = string(value.type, `${path}.type`);
  if (!['uint', 'flags', 'bytes', 'mac', 'ipv4', 'ipv6', 'string', 'dnsName'].includes(type)) fail('INVALID_SCHEMA', 'Invalid field type.', `${path}.type`);
  const field: FieldDef = { id: shortString(value.id, `${path}.id`, false), name: shortString(value.name, `${path}.name`), type: type as FieldDef['type'], bitLength: parseBitLength(value.bitLength, `${path}.bitLength`) };
  if (value.default !== undefined) field.default = parseValue(value.default, `${path}.default`, budget);
  if (value.enumRef !== undefined) field.enumRef = shortString(value.enumRef, `${path}.enumRef`);
  if (value.description !== undefined) field.description = string(value.description, `${path}.description`);
  if (value.flags !== undefined) field.flags = array(value.flags, `${path}.flags`, 1024).map((entry, index) => { const flag = obj(entry, `${path}.flags[${index}]`); return { bit: integer(flag.bit, `${path}.flags[${index}].bit`, 0), name: shortString(flag.name, `${path}.flags[${index}].name`), ...(flag.description === undefined ? {} : { description: string(flag.description, `${path}.flags[${index}].description`) }) }; });
  if (value.presentIf !== undefined) field.presentIf = parseExpr(value.presentIf, `${path}.presentIf`);
  if (value.decodeBitLength !== undefined) field.decodeBitLength = parseExprLength(value.decodeBitLength, `${path}.decodeBitLength`);
  if (value.computed !== undefined) field.computed = parseComputed(value.computed, `${path}.computed`);
  if (field.default !== undefined && !fieldValueMatchesType(field.default, field.type)) {
    fail('INVALID_FIELD_VALUE', `Default value does not match field type "${field.type}".`, `${path}.default`);
  }
  const fixedBitLength = typeof field.bitLength === 'number' ? field.bitLength : null;
  if (field.flags && fixedBitLength !== null && field.flags.some((flag) => flag.bit >= fixedBitLength)) {
    fail('INVALID_SCHEMA', 'Flag bit lies outside the field width.', `${path}.flags`);
  }
  return field;
}

function parseBitLength(input: unknown, path: string): FieldDef['bitLength'] {
  if (input === 'auto') return input;
  if (typeof input === 'number') return integer(input, path, 0, 1 << 20);
  return parseExprLength(input, path);
}

function parseExprLength(input: unknown, path: string): { expr: Expr; unit: 'bits' | 'bytes' } {
  const value = obj(input, path);
  if (value.unit !== 'bits' && value.unit !== 'bytes') fail('INVALID_SCHEMA', 'Expression length unit must be bits or bytes.', `${path}.unit`);
  return { expr: parseExpr(value.expr, `${path}.expr`), unit: value.unit };
}

function parseExpr(input: unknown, path: string): Expr {
  let nodes = 0;
  const visit = (raw: unknown, currentPath: string, depth: number): Expr => {
    nodes += 1;
    if (depth > MAX_EXPR_DEPTH) fail('EXPR_DEPTH_LIMIT', `Expression depth exceeds ${MAX_EXPR_DEPTH}.`, currentPath);
    if (nodes > MAX_EXPR_NODES) fail('EXPR_NODE_LIMIT', `Expression node count exceeds ${MAX_EXPR_NODES}.`, currentPath);
    const value = obj(raw, currentPath);
    switch (value.kind) {
      case 'const': return { kind: 'const', value: finite(value.value, `${currentPath}.value`) };
      case 'field': return { kind: 'field', fieldId: shortString(value.fieldId, `${currentPath}.fieldId`) };
      case 'payloadBytes': return { kind: 'payloadBytes' };
      case 'headerBytes': return { kind: 'headerBytes' };
      case 'binop': {
        if (!['+', '-', '*', 'div'].includes(value.op as string)) fail('INVALID_SCHEMA', 'Invalid expression operator.', `${currentPath}.op`);
        return { kind: 'binop', op: value.op as '+' | '-' | '*' | 'div', left: visit(value.left, `${currentPath}.left`, depth + 1), right: visit(value.right, `${currentPath}.right`, depth + 1) };
      }
      default: fail('INVALID_SCHEMA', 'Invalid expression node.', `${currentPath}.kind`);
    }
  };
  return visit(input, path, 1);
}

function parseComputed(input: unknown, path: string): FieldDef['computed'] {
  const value = obj(input, path);
  if (value.kind === 'binding') return { kind: 'binding' };
  if (value.kind === 'expr') return { kind: 'expr', expr: parseExpr(value.expr, `${path}.expr`) };
  if (value.kind === 'checksum') {
    if (value.algorithm !== 'inet16' && value.algorithm !== 'crc32c') fail('INVALID_SCHEMA', 'Invalid checksum algorithm.', `${path}.algorithm`);
    if (value.scope !== 'header' && value.scope !== 'headerAndPayload') fail('INVALID_SCHEMA', 'Invalid checksum scope.', `${path}.scope`);
    const result: Extract<FieldDef['computed'], { kind: 'checksum' }> = { kind: 'checksum', algorithm: value.algorithm, scope: value.scope };
    if (value.pseudoHeader !== undefined) { if (!['ipv4', 'ipv6', 'auto'].includes(value.pseudoHeader as string)) fail('INVALID_SCHEMA', 'Invalid pseudo-header.', `${path}.pseudoHeader`); result.pseudoHeader = value.pseudoHeader as 'ipv4' | 'ipv6' | 'auto'; }
    for (const key of ['zeroSubstitute', 'littleEndian'] as const) if (value[key] !== undefined) result[key] = bool(value[key], `${path}.${key}`);
    return result;
  }
  fail('INVALID_SCHEMA', 'Invalid computed field.', `${path}.kind`);
}

function parseLintRules(input: unknown, path: string, fieldIds: Set<string>): NonNullable<ProtocolDefinition['lintRules']> {
  return array(input, path, 128).map((entry, index) => {
    const p = `${path}[${index}]`; const value = obj(entry, p);
    const fieldId = shortString(value.fieldId, `${p}.fieldId`); if (!fieldIds.has(fieldId)) fail('INVALID_SCHEMA', 'Lint rule references an unknown field.', `${p}.fieldId`);
    const severity = value.severity; if (severity !== 'warning' && severity !== 'advisory') fail('INVALID_SCHEMA', 'Invalid lint severity.', `${p}.severity`);
    const common = { fieldId, severity: severity as 'warning' | 'advisory', code: shortString(value.code, `${p}.code`, false), message: string(value.message, `${p}.message`), ...(value.reference === undefined ? {} : { reference: string(value.reference, `${p}.reference`) }) };
    switch (value.kind) {
      case 'value': if (value.operator !== 'equals' && value.operator !== 'notEquals') fail('INVALID_SCHEMA', 'Invalid value rule operator.', `${p}.operator`); return { ...common, kind: 'value', operator: value.operator, value: finite(value.value, `${p}.value`) };
      case 'bitsClear': return { ...common, kind: 'bitsClear', mask: integer(value.mask, `${p}.mask`, 0) };
      case 'incompatibleBits': return { ...common, kind: 'incompatibleBits', leftMask: integer(value.leftMask, `${p}.leftMask`, 1), rightMask: integer(value.rightMask, `${p}.rightMask`, 1) };
      case 'sourceAddress': if (value.family !== 'ipv4' && value.family !== 'ipv6') fail('INVALID_SCHEMA', 'Invalid address family.', `${p}.family`); return { ...common, kind: 'sourceAddress', family: value.family };
      case 'zeroWhenCarriedBy': return { ...common, kind: 'zeroWhenCarriedBy', protocolId: shortString(value.protocolId, `${p}.protocolId`) };
      case 'payloadBindingMismatch': return { ...common, kind: 'payloadBindingMismatch' };
      case 'wellKnownPayload': return { ...common, kind: 'wellKnownPayload' };
      default: fail('INVALID_SCHEMA', 'Invalid lint rule kind.', `${p}.kind`);
    }
  });
}

function parseSavedStack(input: unknown, path: string, budget: { bytes: number }): WorkspaceSavedStack {
  const value = obj(input, path); const stack = parseStack(value, path, budget);
  return { id: shortString(value.id, `${path}.id`, false), name: string(value.name, `${path}.name`), savedAt: integer(value.savedAt, `${path}.savedAt`, 0), layers: stack.layers.map(stripUid), trailingPayload: stack.trailingPayload ?? new Uint8Array(), expectedBytes: decodeBytes(value.expectedBytes, `${path}.expectedBytes`, budget, MAX_PACKET) };
}

function parseWorkspaceStack(input: unknown, path: string, budget: { bytes: number }): WorkspaceStack {
  const value = obj(input, path);
  return { stack: parseStack(value, path, budget), expectedBytes: decodeBytes(value.expectedBytes, `${path}.expectedBytes`, budget, MAX_PACKET) };
}

function parseStack(input: unknown, path: string, budget: { bytes: number }): StackInstance {
  const value = obj(input, path);
  const layers = array(value.layers, `${path}.layers`, MAX_LAYERS).map((entry, index) => {
    const p = `${path}.layers[${index}]`; const layer = obj(entry, p); const overrides = obj(layer.overrides, `${p}.overrides`);
    if (Object.keys(overrides).length > MAX_FIELDS) fail('ARRAY_LIMIT', `Layer overrides exceed ${MAX_FIELDS}.`, `${p}.overrides`);
    const parsedOverrides = Object.fromEntries(Object.entries(overrides).map(([key, raw]) => [key, parseValue(raw, `${p}.overrides.${key}`, budget)]));
    return { ...newLayer(shortString(layer.protocolId, `${p}.protocolId`, false)), overrides: parsedOverrides, pinned: array(layer.pinned, `${p}.pinned`, MAX_FIELDS).map((item, pinIndex) => shortString(item, `${p}.pinned[${pinIndex}]`)) };
  });
  return { layers, trailingPayload: decodeBytes(value.trailingPayload, `${path}.trailingPayload`, budget, MAX_PACKET) };
}

function parseScenario(input: unknown, path: string, budget: { bytes: number }): WorkspaceComposedScenario {
  const value = obj(input, path); if (value.version !== 1) fail('INVALID_SCHEMA', 'Unsupported composed scenario version.', `${path}.version`);
  const endpoints = array(value.endpoints, `${path}.endpoints`, 2); if (endpoints.length !== 2) fail('INVALID_SCHEMA', 'Scenario requires two endpoints.', `${path}.endpoints`);
  const expectedBytesByStep: Record<string, Uint8Array> = {};
  const steps = array(value.steps, `${path}.steps`, MAX_STEPS).map((entry, index) => {
    const p = `${path}.steps[${index}]`; const step = obj(entry, p); const id = shortString(step.id, `${p}.id`, false);
    expectedBytesByStep[id] = decodeBytes(step.expectedBytes, `${p}.expectedBytes`, budget, MAX_PACKET);
    const fromEndpoint = integer(step.fromEndpoint, `${p}.fromEndpoint`, 0, 1) as 0 | 1; const toEndpoint = integer(step.toEndpoint, `${p}.toEndpoint`, 0, 1) as 0 | 1;
    return { id, label: string(step.label, `${p}.label`), fromEndpoint, toEndpoint, atUsec: integer(step.atUsec, `${p}.atUsec`, 0), stack: parseStack(step.stack, `${p}.stack`, budget) };
  });
  rejectDuplicate(steps.map((step) => step.id), `${path}.steps`, 'DUPLICATE_STEP_ID');
  return { scenario: { version: 1, id: shortString(value.id, `${path}.id`, false), name: string(value.name, `${path}.name`), description: string(value.description, `${path}.description`), endpoints: [string(endpoints[0], `${path}.endpoints[0]`), string(endpoints[1], `${path}.endpoints[1]`)], steps }, expectedBytesByStep };
}

function parseComparison(input: unknown, path: string, budget: { bytes: number }): ComparisonPacket {
  const value = obj(input, path); const packetValue = obj(value.packet, `${path}.packet`); const bytes = decodeBytes(packetValue.bytes, `${path}.packet.bytes`, budget, MAX_COMPARISON_PACKET); const payloadOffset = integer(packetValue.payloadOffset, `${path}.packet.payloadOffset`, 0, bytes.length);
  const layers = array(packetValue.layers, `${path}.packet.layers`, MAX_LAYERS).map((entry, index) => { const p = `${path}.packet.layers[${index}]`; const layer = obj(entry, p); const byteOffset = integer(layer.byteOffset, `${p}.byteOffset`, 0, bytes.length); const headerBytes = integer(layer.headerBytes, `${p}.headerBytes`, 0, bytes.length - byteOffset); return { uid: shortString(layer.uid, `${p}.uid`), protocolId: shortString(layer.protocolId, `${p}.protocolId`), byteOffset, headerBytes }; });
  rejectDuplicate(layers.map((layer) => layer.uid), `${path}.packet.layers`, 'DUPLICATE_LAYER_ID');
  const layerIds = new Set(layers.map((layer) => layer.uid));
  const spans = array(packetValue.spans, `${path}.packet.spans`, MAX_SPANS).map((entry, index) => { const p = `${path}.packet.spans[${index}]`; const span = obj(entry, p); const bitOffset = integer(span.bitOffset, `${p}.bitOffset`, 0, bytes.length * 8); const bitLength = integer(span.bitLength, `${p}.bitLength`, 0, bytes.length * 8 - bitOffset); const layerUid = shortString(span.layerUid, `${p}.layerUid`); if (!layerIds.has(layerUid)) fail('INVALID_SPAN_LAYER', `Span references unknown layer "${layerUid}".`, `${p}.layerUid`); return { layerUid, fieldId: shortString(span.fieldId, `${p}.fieldId`), bitOffset, bitLength, value: parseValue(span.value, `${p}.value`, budget), computed: bool(span.computed, `${p}.computed`), pinned: bool(span.pinned, `${p}.pinned`) }; });
  rejectDuplicate(spans.map((span) => `${span.layerUid}\0${span.fieldId}`), `${path}.packet.spans`, 'DUPLICATE_FIELD_SPAN');
  const issues = array(packetValue.issues, `${path}.packet.issues`, MAX_SPANS).map((entry, index) => { const p = `${path}.packet.issues[${index}]`; const issue = obj(entry, p); if (issue.severity !== 'error' && issue.severity !== 'warning') fail('INVALID_SCHEMA', 'Invalid issue severity.', `${p}.severity`); return { severity: issue.severity as 'error' | 'warning', layerUid: issue.layerUid === null ? null : shortString(issue.layerUid, `${p}.layerUid`), message: string(issue.message, `${p}.message`) }; });
  return { id: integer(value.id, `${path}.id`, 0), label: string(value.label, `${path}.label`), packet: { bytes, payloadOffset, layers, spans, issues } };
}

function parseValue(input: unknown, path: string, budget: { bytes: number }): FieldValue {
  if (typeof input === 'number') return finite(input, path);
  if (typeof input === 'string') return string(input, path);
  const value = obj(input, path); const keys = Object.keys(value);
  if (keys.length !== 1) fail('MALFORMED_TAG', 'Field value tag must contain exactly one property.', path);
  if ('$bytes' in value) return decodeBytes(value, path, budget, MAX_PACKET);
  if ('$bigint' in value && typeof value.$bigint === 'string' && value.$bigint.length <= 100 && /^-?(0|[1-9]\d*)$/.test(value.$bigint)) return BigInt(value.$bigint);
  fail('MALFORMED_TAG', 'Field value must be a number, string, $bytes, or $bigint tag.', path);
}

function encodeValue(value: FieldValue): WireValue { return value instanceof Uint8Array ? encodeBytes(value) : typeof value === 'bigint' ? { $bigint: value.toString() } : value; }
function encodeBytes(value: Uint8Array): { $bytes: string } { let binary = ''; for (const byte of value) binary += String.fromCharCode(byte); return { $bytes: btoa(binary) }; }
function decodeBytes(input: unknown, path: string, budget: { bytes: number }, max: number): Uint8Array {
  const value = obj(input, path); if (Object.keys(value).length !== 1 || typeof value.$bytes !== 'string') fail('MALFORMED_BYTES_TAG', 'Expected an object containing only a $bytes base64 string.', path);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.$bytes)) fail('INVALID_BASE64', 'Invalid base64 byte encoding.', path);
  let binary: string; try { binary = atob(value.$bytes); } catch { fail('INVALID_BASE64', 'Invalid base64 byte encoding.', path); }
  if (binary.length > max) fail('BINARY_ITEM_LIMIT', `Decoded binary at ${path} exceeds ${max} bytes.`, path);
  budget.bytes += binary.length; if (budget.bytes > MAX_BINARY) fail('BINARY_TOTAL_LIMIT', `Decoded workspace binary exceeds ${MAX_BINARY} bytes.`, path);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function verifyStack(stack: StackLike, expected: Uint8Array, registry: ReturnType<typeof createBuiltinRegistry>, path: string, errors: WorkspaceDiagnostic[]): void {
  if (!validateStackReferences(stack, registry, path, errors)) return;
  try {
    const serialized = serializeStack(runtimeStack(stack, path), registry);
    const serializationErrors = serialized.issues.filter((item) => item.severity === 'error');
    if (serializationErrors.length > 0) {
      errors.push({ code: 'STACK_SERIALIZATION_FAILED', message: `Could not serialize ${path}: ${serializationErrors[0]!.message}`, path });
    } else if (!bytesEqual(serialized.bytes, expected)) {
      errors.push({ code: 'EXPECTED_BYTES_MISMATCH', message: `Serialized bytes do not match the workspace snapshot for ${path}.`, path });
    }
  }
  catch (error) { errors.push({ code: 'STACK_SERIALIZATION_FAILED', message: `Could not serialize ${path}: ${error instanceof Error ? error.message : String(error)}`, path }); }
}

function validateStackReferences(
  stack: StackLike,
  registry: ReturnType<typeof createBuiltinRegistry>,
  path: string,
  errors: WorkspaceDiagnostic[],
): boolean {
  let valid = true;
  stack.layers.forEach((layer, index) => {
    const layerPath = `${path}.layers.${index}`;
    const definition = registry.get(layer.protocolId);
    if (!definition) {
      errors.push({ code: 'UNKNOWN_PROTOCOL', message: `Stack references unknown protocol "${layer.protocolId}".`, path: layerPath });
      valid = false;
      return;
    }
    const fields = new Map(definition.fields.map((field) => [field.id, field]));
    for (const [fieldId, value] of Object.entries(layer.overrides)) {
      const field = fields.get(fieldId);
      if (!field) {
        errors.push({ code: 'UNKNOWN_FIELD', message: `Override references unknown field "${fieldId}" in "${layer.protocolId}".`, path: `${layerPath}.overrides.${fieldId}` });
        valid = false;
      } else {
        try {
          if (field.type === 'uint' || field.type === 'flags') valueToNumber(field, value);
          else valueToBytes(field, value);
        } catch {
          errors.push({ code: 'INVALID_FIELD_VALUE', message: `Override for "${fieldId}" does not match field type "${field.type}".`, path: `${layerPath}.overrides.${fieldId}` });
          valid = false;
        }
      }
    }
    for (const fieldId of layer.pinned) {
      const field = fields.get(fieldId);
      if (!field?.computed) {
        errors.push({ code: 'INVALID_PINNED_FIELD', message: `Pinned field "${fieldId}" is missing or not computed.`, path: `${layerPath}.pinned` });
        valid = false;
      }
    }
  });
  return valid;
}

function validateProspectiveWorkspace(
  workspace: WorkspaceLocalSnapshot,
  registry: ReturnType<typeof createBuiltinRegistry>,
  errors: WorkspaceDiagnostic[],
): void {
  for (const saved of workspace.savedStacks) {
    validateRuntimeStack(saved, registry, `prospective.savedStacks.${saved.id}`, errors);
  }
  validateRuntimeStack(workspace.currentStack, registry, 'prospective.currentStack', errors);
  if (workspace.composedScenario) {
    for (const step of workspace.composedScenario.steps) {
      validateRuntimeStack(step.stack, registry, `prospective.composedScenario.steps.${step.id}`, errors);
    }
  }
  for (const [index, comparison] of workspace.comparisons.entries()) {
    validateComparisonProtocols(comparison, registry, `prospective.comparisons.${index}`, errors);
  }
}

function validateRuntimeStack(
  stack: StackLike,
  registry: ReturnType<typeof createBuiltinRegistry>,
  path: string,
  errors: WorkspaceDiagnostic[],
): void {
  if (!validateStackReferences(stack, registry, path, errors)) return;
  try {
    const packet = serializeStack(runtimeStack(stack, path), registry);
    for (const item of packet.issues.filter((issue) => issue.severity === 'error')) {
      errors.push({ code: 'STACK_SERIALIZATION_FAILED', message: `Could not serialize ${path}: ${item.message}`, path });
    }
  } catch (error) {
    errors.push({ code: 'STACK_SERIALIZATION_FAILED', message: `Could not serialize ${path}: ${error instanceof Error ? error.message : String(error)}`, path });
  }
}

function validateComparisonProtocols(
  comparison: ComparisonPacket,
  registry: ReturnType<typeof createBuiltinRegistry>,
  path: string,
  errors: WorkspaceDiagnostic[],
): void {
  const byUid = new Map(comparison.packet.layers.map((layer) => [layer.uid, layer]));
  for (const layer of comparison.packet.layers) {
    if (!registry.get(layer.protocolId)) {
      errors.push({ code: 'UNKNOWN_PROTOCOL', message: `Comparison references unknown protocol "${layer.protocolId}".`, path: `${path}.packet.layers` });
    }
  }
  for (const span of comparison.packet.spans) {
    const layer = byUid.get(span.layerUid);
    const definition = layer ? registry.get(layer.protocolId) : undefined;
    if (!definition?.fields.some((field) => field.id === span.fieldId)) {
      errors.push({ code: 'UNKNOWN_FIELD', message: `Comparison span references unknown field "${span.fieldId}".`, path: `${path}.packet.spans` });
    }
  }
}

function validateProtocolRelationships(definition: ProtocolDefinition, path: string): void {
  const fieldIds = new Set(definition.fields.map((field) => field.id));
  for (const [index, namespace] of definition.providesNamespaces.entries()) {
    if (namespace.selectorFieldId !== null && !fieldIds.has(namespace.selectorFieldId)) {
      fail('INVALID_SCHEMA', `Namespace selector references unknown field "${namespace.selectorFieldId}".`, `${path}.providesNamespaces[${index}].selectorFieldId`);
    }
  }
  const checkExpr = (expr: Expr | undefined, exprPath: string): void => {
    if (!expr) return;
    if (expr.kind === 'field' && !fieldIds.has(expr.fieldId)) {
      fail('INVALID_SCHEMA', `Expression references unknown field "${expr.fieldId}".`, exprPath);
    }
    if (expr.kind === 'binop') {
      checkExpr(expr.left, `${exprPath}.left`);
      checkExpr(expr.right, `${exprPath}.right`);
    }
  };
  for (const [index, field] of definition.fields.entries()) {
    const fieldPath = `${path}.fields[${index}]`;
    checkExpr(field.presentIf, `${fieldPath}.presentIf`);
    if (typeof field.bitLength === 'object') checkExpr(field.bitLength.expr, `${fieldPath}.bitLength.expr`);
    checkExpr(field.decodeBitLength?.expr, `${fieldPath}.decodeBitLength.expr`);
    if (field.computed?.kind === 'expr') checkExpr(field.computed.expr, `${fieldPath}.computed.expr`);
  }
}

function fieldValueMatchesType(value: FieldValue, type: FieldDef['type']): boolean {
  if (type === 'uint' || type === 'flags') {
    return (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'bigint';
  }
  if (type === 'bytes') return value instanceof Uint8Array;
  return typeof value === 'string';
}

function runtimeStack(stack: StackLike, prefix: string): StackInstance { return { layers: stack.layers.map((layer, index) => ({ uid: 'uid' in layer ? layer.uid : `${prefix}-${index}`, protocolId: layer.protocolId, overrides: cloneOverrides(layer.overrides), pinned: [...layer.pinned] })), trailingPayload: new Uint8Array(stack.trailingPayload ?? []) }; }
function stripUid(layer: LayerInstance): Pick<LayerInstance, 'protocolId' | 'overrides' | 'pinned'> { return { protocolId: layer.protocolId, overrides: cloneOverrides(layer.overrides), pinned: [...layer.pinned] }; }
function cloneOverrides(overrides: Record<string, FieldValue>): Record<string, FieldValue> { return Object.fromEntries(Object.entries(overrides).map(([key, value]) => [key, value instanceof Uint8Array ? new Uint8Array(value) : value])); }
function cloneStack(stack: StackInstance): StackInstance { return runtimeStack(stack, 'clone'); }
function cleanSaved(saved: WorkspaceSavedStack): SavedStack { return { id: saved.id, name: saved.name, savedAt: saved.savedAt, layers: saved.layers.map((layer) => ({ protocolId: layer.protocolId, overrides: cloneOverrides(layer.overrides), pinned: [...layer.pinned] })), trailingPayload: new Uint8Array(saved.trailingPayload) }; }
function cloneSaved(stacks: SavedStack[]): SavedStack[] { return stacks.map((stack) => cleanSaved({ ...stack, expectedBytes: new Uint8Array() })); }
function cloneProtocol(definition: ProtocolDefinition): ProtocolDefinition { return structuredClone(definition); }
function cloneProtocols(definitions: ProtocolDefinition[]): ProtocolDefinition[] { return definitions.map(cloneProtocol); }
function cloneComparison(item: ComparisonPacket): ComparisonPacket { return structuredClone(item); }
function cloneScenario(scenario: ComposedScenario): ComposedScenario { return structuredClone(scenario); }
function cloneLocal(local: WorkspaceLocalSnapshot): WorkspaceLocalSnapshot { return { customProtocols: cloneProtocols(local.customProtocols), savedStacks: cloneSaved(local.savedStacks), currentStack: cloneStack(local.currentStack), comparisons: local.comparisons.map(cloneComparison), composedScenario: local.composedScenario == null ? null : cloneScenario(local.composedScenario) }; }
function addStackProtocols(stack: Pick<StackLike, 'layers'>, ids: Set<string>): void { for (const layer of stack.layers) ids.add(layer.protocolId); }
function selectById<T extends { id: string }>(items: T[], selection: boolean | string[] | undefined): T[] { if (selection === true) return items; if (!Array.isArray(selection)) return []; const selected = new Set(selection); return items.filter((item) => selected.has(item.id)); }
function uniqueCopyId(id: string, stacks: SavedStack[], seed: number): string { let suffix = Math.max(2, seed + 2); let candidate = `${id}-copy`; while (stacks.some((item) => item.id === candidate)) candidate = `${id}-copy-${suffix++}`; return candidate; }
function bytesEqual(left: Uint8Array, right: Uint8Array): boolean { return left.length === right.length && left.every((byte, index) => byte === right[index]); }

function obj(input: unknown, path: string): JsonObject { if (input === null || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_SCHEMA', `Expected an object at ${path}.`, path); return input as JsonObject; }
function array(input: unknown, path: string, max: number): unknown[] { if (!Array.isArray(input)) fail('INVALID_SCHEMA', `Expected an array at ${path}.`, path); if (input.length > max) fail('ARRAY_LIMIT', `Array at ${path} exceeds the limit of ${max}.`, path); return input; }
function string(input: unknown, path: string): string { if (typeof input !== 'string' || input.length > MAX_STRING) fail('INVALID_STRING', `Expected a string of at most ${MAX_STRING} characters at ${path}.`, path); return input; }
function shortString(input: unknown, path: string, empty = true): string { const value = string(input, path); if ((!empty && value.length === 0) || value.length > 200) fail('INVALID_STRING', `Expected ${path} to be ${empty ? 'at most' : 'between 1 and'} 200 characters.`, path); return value; }
function finite(input: unknown, path: string): number { if (typeof input !== 'number' || !Number.isFinite(input)) fail('INVALID_NUMBER', `Expected a finite number at ${path}.`, path); return input; }
function integer(input: unknown, path: string, min: number, max = Number.MAX_SAFE_INTEGER): number { if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < min || input > max) fail('INVALID_NUMBER', `Expected an integer from ${min} to ${max} at ${path}.`, path); return input; }
function bool(input: unknown, path: string): boolean { if (typeof input !== 'boolean') fail('INVALID_SCHEMA', `Expected a boolean at ${path}.`, path); return input; }
function rejectDuplicate(ids: string[], path: string, code: string): void { const seen = new Set<string>(); for (const id of ids) { if (seen.has(id)) fail(code, `Duplicate ID "${id}" at ${path}.`, path); seen.add(id); } }
function fail(code: string, message: string, path?: string): never { throw new WorkspaceJsonError(code, message, path); }
