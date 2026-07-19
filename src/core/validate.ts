/**
 * Stack validation driven entirely by the binding model: a stack is valid
 * when every adjacent layer pair intersects on a namespace (the outer layer
 * provides it, the inner layer claims it).
 */
import type { ProtocolDefinition, StackInstance } from './model';
import type { Registry } from './registry';
import type { SerializedPacket } from './serialize';
import { carriersOf, resolveBinding } from './bindings';

const STANDARD_ETHERNET_MTU = 1500;
const ETHERNET_PROTOCOL_IDS = new Set(['ethernet', 'ethernet-8023']);

/**
 * The dedicated IPv6 extension headers (RFC 8200 §4.1), with their recommended
 * position (`rank`) and how many times each may appear. Destination Options is
 * the only one allowed twice — once before Routing, once before the upper
 * layer. AH/ESP are also extension headers in IPv6 but double as standalone
 * IPsec carriers, so they are left out of these ordering/duplicate checks.
 */
const IPV6_EXT_HEADERS: Record<string, { rank: number; maxCount: number }> = {
  'ipv6-hopopts': { rank: 0, maxCount: 1 },
  'ipv6-dstopts': { rank: 1, maxCount: 2 },
  'ipv6-routing': { rank: 2, maxCount: 1 },
  'ipv6-frag': { rank: 3, maxCount: 1 },
};

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

export function validateStack(
  stack: StackInstance,
  registry: Registry,
  packet?: SerializedPacket,
): ValidationIssue[] {
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

  addExtensionHeaderIssues(issues, defs as ProtocolDefinition[]);

  if (packet) addMtuIssues(issues, stack, defs as ProtocolDefinition[], packet);

  return issues;
}

/**
 * Warn about IPv6 extension-header chains that are legal by the binding model
 * but violate RFC 8200 §4.1 ordering/repetition rules. Warnings, not errors:
 * the tool is a teaching sandbox, and building an "illegal" chain on purpose
 * is a valid thing to explore.
 */
function addExtensionHeaderIssues(issues: ValidationIssue[], defs: ProtocolDefinition[]): void {
  // Hop-by-Hop Options, if present, must immediately follow the IPv6 header.
  defs.forEach((def, i) => {
    if (def.id !== 'ipv6-hopopts') return;
    if (i === 0 || defs[i - 1]!.id !== 'ipv6') {
      issues.push({
        severity: 'warning',
        layerIndex: i,
        code: 'hopopts-not-first',
        message: `${def.name} must immediately follow the IPv6 header (RFC 8200 §4.1).`,
        suggestion: 'Move Hop-by-Hop Options to directly after IPv6.',
      });
    }
  });

  // No extension header may repeat — except Destination Options, allowed twice.
  const counts = new Map<string, number>();
  defs.forEach((def, i) => {
    const spec = IPV6_EXT_HEADERS[def.id];
    if (!spec) return;
    const n = (counts.get(def.id) ?? 0) + 1;
    counts.set(def.id, n);
    if (n > spec.maxCount) {
      issues.push({
        severity: 'warning',
        layerIndex: i,
        code: 'duplicate-ext-header',
        message: `${def.name} appears ${
          spec.maxCount === 1 ? 'more than once' : 'more than twice'
        }; IPv6 allows it at most ${spec.maxCount === 1 ? 'once' : 'twice'} (RFC 8200 §4.1).`,
      });
    }
  });

  // Fixed-position extension headers should appear in the recommended order.
  // Hop-by-Hop is covered above; Destination Options has a flexible position,
  // so both are skipped here (this effectively checks Routing before Fragment).
  let lastRank = -1;
  let lastName = '';
  defs.forEach((def, i) => {
    const spec = IPV6_EXT_HEADERS[def.id];
    if (!spec || def.id === 'ipv6-hopopts' || def.id === 'ipv6-dstopts') return;
    if (spec.rank < lastRank) {
      issues.push({
        severity: 'warning',
        layerIndex: i,
        code: 'ext-header-order',
        message: `${def.name} should come before ${lastName} in an IPv6 extension-header chain (RFC 8200 §4.1).`,
      });
    } else {
      lastRank = spec.rank;
      lastName = def.name;
    }
  });
}

function addMtuIssues(
  issues: ValidationIssue[],
  stack: StackInstance,
  defs: ProtocolDefinition[],
  packet: SerializedPacket,
): void {
  const dfReported = new Set<number>();
  for (let ethernetIndex = 0; ethernetIndex < defs.length; ethernetIndex++) {
    if (!ETHERNET_PROTOCOL_IDS.has(defs[ethernetIndex]!.id)) continue;

    const ethernetLayout = packet.layers[ethernetIndex];
    if (!ethernetLayout) continue;
    const l2PayloadBytes =
      packet.bytes.length - ethernetLayout.byteOffset - ethernetLayout.headerBytes;
    if (l2PayloadBytes <= STANDARD_ETHERNET_MTU) continue;

    const layouts = packet.layers.slice(ethernetIndex);
    const headerBytes = layouts.reduce((total, layer) => total + layer.headerBytes, 0);
    const trailingBytes = packet.bytes.length - packet.payloadOffset;
    const breakdown = layouts
      .map((layout, offset) => `${defs[ethernetIndex + offset]!.name} ${layout.headerBytes}`)
      .join(' + ');

    issues.push({
      severity: 'info',
      layerIndex: ethernetIndex,
      code: 'ethernet-mtu-exceeded',
      message: `${defs[ethernetIndex]!.name} payload is ${l2PayloadBytes} bytes, exceeding the standard Ethernet MTU (${STANDARD_ETHERNET_MTU}); it would require jumbo frames or fragmentation.`,
      suggestion: `Header overhead is ${headerBytes} bytes (${breakdown}) before ${trailingBytes} bytes of payload.`,
    });

    const ipv4Index = defs.findIndex(
      (def, index) => index > ethernetIndex && def.id === 'ipv4',
    );
    if (ipv4Index === -1) continue;
    const ipv4Layout = packet.layers[ipv4Index];
    if (!ipv4Layout) continue;
    const ipv4Bytes = packet.bytes.length - ipv4Layout.byteOffset;
    if (
      ipv4Bytes <= STANDARD_ETHERNET_MTU ||
      dfReported.has(ipv4Index) ||
      !ipv4DfIsSet(stack, packet, ipv4Index)
    )
      continue;

    dfReported.add(ipv4Index);
    issues.push({
      severity: 'info',
      layerIndex: ipv4Index,
      code: 'ipv4-df-mtu-exceeded',
      message: `IPv4 datagram is ${ipv4Bytes} bytes with Don't Fragment set; on a ${STANDARD_ETHERNET_MTU}-byte MTU path it would be dropped and trigger ICMP Fragmentation Needed.`,
    });
  }
}

function ipv4DfIsSet(
  stack: StackInstance,
  packet: SerializedPacket,
  layerIndex: number,
): boolean {
  const layer = stack.layers[layerIndex];
  if (!layer) return false;
  const flags = packet.spans.find(
    (span) => span.layerUid === layer.uid && span.fieldId === 'flags',
  )?.value;
  return (
    (typeof flags === 'number' || typeof flags === 'bigint') &&
    (BigInt(flags) & 0b010n) !== 0n
  );
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
