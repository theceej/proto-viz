/**
 * Binding namespaces: the generic mechanism behind "IPv4 over Ethernet when
 * EtherType = 0x0800". Providers declare a namespace (and which of their
 * fields selects the payload); payload protocols claim membership with a
 * value. The intersection drives stack validation AND auto-setting of
 * selector fields at serialization time.
 */
import type {
  BindingNamespace,
  EncapsulationClaim,
  ProtocolDefinition,
} from './model';

/** Well-known namespace ids used by the builtin protocols. */
export const NS = {
  ethertype: 'ethertype',
  ipProto: 'ip-proto',
  udpDstPort: 'udp-dstport',
  tcpDstPort: 'tcp-dstport',
  greProto: 'gre-proto', // GRE protocol type field (EtherType-coded)
  pppProto: 'ppp-proto',
  vxlanPayload: 'vxlan-payload', // opaque: VXLAN always carries Ethernet
  l2tpPayload: 'l2tp-payload',
  tlsPayload: 'tls-payload', // opaque: TLS fragment content
  icmpPayload: 'icmp-payload', // opaque: quoted datagram inside ICMP errors
} as const;

export interface ResolvedBinding {
  namespace: BindingNamespace;
  claim: EncapsulationClaim;
}

/**
 * Find how `inner` can sit directly inside `outer`, or null if it can't.
 * Prefers value-carrying claims over opaque ones.
 */
export function resolveBinding(
  outer: ProtocolDefinition,
  inner: ProtocolDefinition,
): ResolvedBinding | null {
  const provided = new Map(outer.providesNamespaces.map((ns) => [ns.id, ns]));
  let opaque: ResolvedBinding | null = null;
  for (const claim of inner.encapsulations) {
    const namespace = provided.get(claim.namespaceId);
    if (!namespace) continue;
    if (claim.value !== undefined && namespace.selectorFieldId !== null)
      return { namespace, claim };
    if (opaque === null) opaque = { namespace, claim };
  }
  return opaque;
}

/** All protocols in `all` that provide a namespace claimed by `inner`. */
export function carriersOf(
  inner: ProtocolDefinition,
  all: ProtocolDefinition[],
): ProtocolDefinition[] {
  const claimed = new Set(inner.encapsulations.map((c) => c.namespaceId));
  return all.filter((p) => p.providesNamespaces.some((ns) => claimed.has(ns.id)));
}
