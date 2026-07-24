import type { FieldValue, SemanticLintRule, StackInstance } from './model';
import type { Registry } from './registry';
import type { SerializedPacket } from './serialize';

export interface SemanticLintIssue {
  severity: 'warning' | 'advisory';
  layerIndex: number;
  fieldId: string;
  code: string;
  message: string;
  reference?: string;
  source: 'semantic';
}

/** Evaluate declarative, non-blocking semantic rules against resolved wire values. */
export function lintPacket(
  stack: StackInstance,
  registry: Registry,
  packet: SerializedPacket,
): SemanticLintIssue[] {
  const issues: SemanticLintIssue[] = [];
  stack.layers.forEach((layer, layerIndex) => {
    const def = registry.get(layer.protocolId);
    if (!def?.lintRules) return;
    for (const rule of def.lintRules) {
      const value = packet.spans.find(
        (span) => span.layerUid === layer.uid && span.fieldId === rule.fieldId,
      )?.value;
      if (value === undefined || !matches(rule, value, layerIndex, stack, registry)) continue;
      issues.push({
        severity: rule.severity,
        layerIndex,
        fieldId: rule.fieldId,
        code: rule.code,
        message: rule.message,
        reference: rule.reference,
        source: 'semantic',
      });
    }
  });
  return issues;
}

function matches(
  rule: SemanticLintRule,
  value: FieldValue,
  layerIndex: number,
  stack: StackInstance,
  registry: Registry,
): boolean {
  switch (rule.kind) {
    case 'value': {
      const numeric = numericValue(value);
      if (numeric === null) return false;
      return rule.operator === 'equals' ? numeric === rule.value : numeric !== rule.value;
    }
    case 'bitsClear': {
      const numeric = numericValue(value);
      return numeric !== null && (numeric & rule.mask) !== 0;
    }
    case 'incompatibleBits': {
      const numeric = numericValue(value);
      return (
        numeric !== null &&
        (numeric & rule.leftMask) !== 0 &&
        (numeric & rule.rightMask) !== 0
      );
    }
    case 'sourceAddress':
      return suspiciousSource(value, rule.family, hasLinkCarrier(stack, registry, layerIndex));
    case 'zeroWhenCarriedBy':
      return (
        numericValue(value) === 0 &&
        stack.layers.slice(0, layerIndex).some((layer) => layer.protocolId === rule.protocolId)
      );
    case 'payloadBindingMismatch': {
      const encoded = numericValue(value);
      const next = stack.layers[layerIndex + 1];
      const def = registry.get(stack.layers[layerIndex]!.protocolId);
      const nextDef = next ? registry.get(next.protocolId) : undefined;
      const namespace = def?.providesNamespaces.find(
        (candidate) => candidate.selectorFieldId === rule.fieldId,
      );
      const expected = nextDef?.encapsulations.find(
        (claim) => claim.namespaceId === namespace?.id,
      )?.value;
      return encoded !== null && expected !== undefined && encoded !== expected;
    }
    case 'wellKnownPayload': {
      const port = numericValue(value);
      if (port === null || stack.layers[layerIndex + 1]) return false;
      const def = registry.get(stack.layers[layerIndex]!.protocolId);
      const namespace = def?.providesNamespaces.find(
        (candidate) => candidate.selectorFieldId === rule.fieldId,
      );
      return Boolean(
        namespace &&
          registry.all().some((candidate) =>
            candidate.encapsulations.some(
              (claim) => claim.namespaceId === namespace.id && claim.value === port,
            ),
          ),
      );
    }
  }
}

function numericValue(value: FieldValue): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return null;
}

function hasLinkCarrier(stack: StackInstance, registry: Registry, layerIndex: number): boolean {
  return stack.layers
    .slice(0, layerIndex)
    .some((layer) => registry.get(layer.protocolId)?.layerHint === 'link');
}

function suspiciousSource(value: FieldValue, family: 'ipv4' | 'ipv6', acrossLink: boolean): boolean {
  if (typeof value !== 'string') return false;
  if (family === 'ipv4') {
    const parts = value.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
    const [first] = parts;
    const multicast = first! >= 224 && first! <= 239;
    const broadcast = parts.every((part) => part === 255);
    const loopback = first === 127;
    return multicast || broadcast || (acrossLink && loopback);
  }
  const normalized = value.toLowerCase();
  const multicast = normalized.startsWith('ff');
  const loopback = normalized === '::1' || normalized === '0:0:0:0:0:0:0:1';
  return multicast || (acrossLink && loopback);
}
