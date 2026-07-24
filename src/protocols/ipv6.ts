import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { E } from '../core/expr';

export const ipv6: ProtocolDefinition = {
  id: 'ipv6',
  name: 'IPv6',
  fullName: 'Internet Protocol version 6',
  layerHint: 'network',
  source: 'builtin',
  description:
    'The 128-bit-address Internet Protocol. Payload Length is computed automatically and Next Header is auto-set from the next layer. Extension headers (Hop-by-Hop, Routing, Fragment, Destination Options) are separate protocols you can layer in between IPv6 and the transport header.',
  fields: [
    { id: 'version', name: 'Version', type: 'uint', bitLength: 4, default: 6, description: 'Always 6.' },
    { id: 'trafficClass', name: 'Traffic Class', type: 'uint', bitLength: 8, default: 0, description: 'DSCP + ECN.' },
    { id: 'flowLabel', name: 'Flow Label', type: 'uint', bitLength: 20, default: 0, description: 'Flow identifier for QoS.' },
    {
      id: 'payloadLength',
      name: 'Payload Length',
      type: 'uint',
      bitLength: 16,
      computed: { kind: 'expr', expr: E.payloadBytes() },
      description: 'Bytes following this header.',
    },
    {
      id: 'nextHeader',
      name: 'Next Header',
      type: 'uint',
      bitLength: 8,
      default: 6,
      enumRef: 'ip-proto',
      computed: { kind: 'binding' },
      description: 'Payload protocol number (auto-set from the next layer).',
    },
    { id: 'hopLimit', name: 'Hop Limit', type: 'uint', bitLength: 8, default: 64, description: 'IPv6 TTL.' },
    { id: 'src', name: 'Source Address', type: 'ipv6', bitLength: 128, default: '2001:db8::1' },
    { id: 'dst', name: 'Destination Address', type: 'ipv6', bitLength: 128, default: '2001:db8::2' },
  ],
  lintRules: [
    { kind: 'value', fieldId: 'version', operator: 'notEquals', value: 6, severity: 'warning', code: 'ipv6-version', message: 'IPv6 Version should be 6.', reference: 'RFC 8200 §3' },
    { kind: 'value', fieldId: 'hopLimit', operator: 'equals', value: 0, severity: 'warning', code: 'ipv6-hop-limit-zero', message: 'A Hop Limit of 0 cannot be forwarded beyond the current node.', reference: 'RFC 8200 §3' },
    { kind: 'sourceAddress', fieldId: 'src', family: 'ipv6', severity: 'warning', code: 'ipv6-suspicious-source', message: 'This IPv6 source address is multicast or loopback across a link.', reference: 'RFC 4291 §2.7' },
  ],
  providesNamespaces: [
    { id: NS.ipProto, displayName: 'Next Header', selectorFieldId: 'nextHeader' },
  ],
  encapsulations: [
    { namespaceId: NS.ethertype, value: 0x86dd },
    { namespaceId: NS.ipProto, value: 41 },
    { namespaceId: NS.greProto, value: 0x86dd },
    { namespaceId: NS.pppProto, value: 0x0057 },
    { namespaceId: NS.mplsPayload },
    { namespaceId: NS.icmpPayload },
    { namespaceId: NS.gtpPayload },
  ],
};
