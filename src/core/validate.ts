/**
 * Stack validation driven entirely by the binding model: a stack is valid
 * when every adjacent layer pair intersects on a namespace (the outer layer
 * provides it, the inner layer claims it).
 */
import type { ProtocolDefinition, StackInstance } from './model';
import type { Registry } from './registry';
import { carriersOf, resolveBinding } from './bindings';

export type Severity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  severity: Severity;
  /** Index of the (inner) layer the issue is about, or -1 for whole-stack issues. */
  layerIndex: number;
  code: string;
  message: string;
  suggestion?: string;
}

export interface NextProtocolOption {
  protocolId: string;
  allowed: boolean;
  /** For allowed protocols: how the binding works, e.g. "EtherType 0x0800". */
  via?: string;
  /** Info/warning note (e.g. conventional layering). */
  note?: string;
  /** For disallowed protocols: why not, phrased for a tooltip. */
  reason?: string;
}

export function validateStack(stack: StackInstance, registry: Registry): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const layers = stack.layers;

  if (layers.length === 0) {
    return [
      {
        severity: 'info',
        layerIndex: -1,
        code: 'empty',
        message: 'Add a protocol from the palette to start building a stack.',
      },
    ];
  }

  const defs = layers.map((l) => registry.get(l.protocolId));
  defs.forEach((def, i) => {
    if (!def)
      issues.push({
        severity: 'error',
        layerIndex: i,
        code: 'unknown-protocol',
        message: `Unknown protocol "${layers[i]!.protocolId}".`,
      });
  });
  if (issues.length > 0) return issues;

  const first = defs[0]!;
  if (first.layerHint !== 'link') {
    if (first.layerHint === 'network') {
      issues.push({
        severity: 'warning',
        layerIndex: 0,
        code: 'no-link-layer',
        message: `${first.name} is a network-layer protocol; real captures usually start at a link layer.`,
        suggestion:
          'Export will use the RAW linktype, or wrap the stack in Ethernet from the export dialog.',
      });
    } else {
      issues.push({
        severity: 'error',
        layerIndex: 0,
        code: 'bad-first-layer',
        message: `${first.name} cannot start a packet: it is a ${first.layerHint}-layer protocol and needs to be carried by something.`,
        suggestion: carrierSuggestion(first, registry),
      });
    }
  }

  for (let i = 0; i < defs.length - 1; i++) {
    const outer = defs[i]!;
    const inner = defs[i + 1]!;
    const binding = resolveBinding(outer, inner);

    if (!binding) {
      issues.push({
        severity: 'error',
        layerIndex: i + 1,
        code: 'no-binding',
        message: noBindingMessage(outer, inner),
        suggestion: carrierSuggestion(inner, registry),
      });
      if (outer.layerHint === 'application') {
        issues.push({
          severity: 'warning',
          layerIndex: i + 1,
          code: 'layer-after-application',
          message: `${inner.name} appears after application-layer ${outer.name}; that is unusual.`,
        });
      }
      continue;
    }

    if (binding.namespace.selectorFieldId === null) {
      issues.push({
        severity: 'info',
        layerIndex: i + 1,
        code: 'opaque-binding',
        message: `${outer.name} does not encode its payload type; ${inner.name} inside ${outer.name} is ${
          binding.claim.conventional ? 'conventional' : 'implicit'
        } rather than field-driven.`,
      });
    }

    // Pinned selector that contradicts the binding.
    const selectorId = binding.namespace.selectorFieldId;
    if (selectorId !== null && binding.claim.value !== undefined) {
      const outerInstance = layers[i]!;
      if (outerInstance.pinned.includes(selectorId)) {
        const pinnedValue = outerInstance.overrides[selectorId];
        if (typeof pinnedValue === 'number' && pinnedValue !== binding.claim.value) {
          issues.push({
            severity: 'warning',
            layerIndex: i,
            code: 'pinned-selector-mismatch',
            message: `${outer.name} ${binding.namespace.displayName} is pinned to ${fmtValue(
              pinnedValue,
            )} but the next layer (${inner.name}) implies ${fmtValue(binding.claim.value)}.`,
          });
        }
      }
    }

  }

  return issues;
}

/**
 * For the builder palette: evaluate every protocol in the registry as a
 * candidate next (innermost) layer for the current stack.
 */
export function getValidNextProtocols(
  stack: StackInstance,
  registry: Registry,
): NextProtocolOption[] {
  const last = stack.layers[stack.layers.length - 1];
  const lastDef = last ? registry.get(last.protocolId) : undefined;

  return registry.all().map((candidate) => {
    if (!lastDef) {
      // Empty stack: anything can start it, but non-link starts get a note.
      return {
        protocolId: candidate.id,
        allowed: true,
        note:
          candidate.layerHint === 'link'
            ? undefined
            : candidate.layerHint === 'network'
              ? 'Starting below a link layer exports as a RAW pcap.'
              : `${candidate.name} normally needs a carrier below it.`,
      };
    }
    const binding = resolveBinding(lastDef, candidate);
    if (!binding) {
      return {
        protocolId: candidate.id,
        allowed: false,
        reason: noBindingMessage(lastDef, candidate),
      };
    }
    const via =
      binding.namespace.selectorFieldId === null || binding.claim.value === undefined
        ? binding.namespace.displayName
        : `${binding.namespace.displayName} ${fmtValue(binding.claim.value)}`;
    return {
      protocolId: candidate.id,
      allowed: true,
      via,
      note: binding.claim.conventional ? 'Conventional layering, not field-driven.' : undefined,
    };
  });
}

function noBindingMessage(outer: ProtocolDefinition, inner: ProtocolDefinition): string {
  const provided = outer.providesNamespaces;
  if (provided.length === 0)
    return `${inner.name} cannot follow ${outer.name}: ${outer.name} does not carry any payload protocol.`;
  const names = provided.map((ns) => ns.displayName).join(', ');
  return `${inner.name} cannot follow ${outer.name}: ${outer.name} selects its payload via ${names}, and ${inner.name} has no assignment there.`;
}

function carrierSuggestion(inner: ProtocolDefinition, registry: Registry): string | undefined {
  const carriers = carriersOf(inner, registry.all());
  if (carriers.length === 0) return undefined;
  const parts = carriers.slice(0, 4).map((c) => {
    const ns = c.providesNamespaces.find((n) =>
      inner.encapsulations.some((e) => e.namespaceId === n.id),
    )!;
    const claim = inner.encapsulations.find((e) => e.namespaceId === ns.id)!;
    return claim.value !== undefined
      ? `${c.name} (${ns.displayName} ${fmtValue(claim.value)})`
      : c.name;
  });
  return `${inner.name} is carried by ${parts.join(', ')}.`;
}

function fmtValue(v: number): string {
  return v > 255 ? `0x${v.toString(16).toUpperCase().padStart(4, '0')}` : String(v);
}
