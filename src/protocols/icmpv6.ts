import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

export const icmpv6: ProtocolDefinition = {
  id: 'icmpv6',
  name: 'ICMPv6',
  fullName: 'Internet Control Message Protocol for IPv6',
  layerHint: 'network',
  source: 'builtin',
  description:
    'Control, error, and neighbor-discovery messages for IPv6. The checksum includes the IPv6 pseudo-header. Defaults model an echo request.',
  fields: [
    { id: 'type', name: 'Type', type: 'uint', bitLength: 8, default: 128, enumRef: 'icmpv6-type', description: '128 = echo request.' },
    { id: 'code', name: 'Code', type: 'uint', bitLength: 8, default: 0 },
    {
      id: 'checksum',
      name: 'Checksum',
      type: 'uint',
      bitLength: 16,
      computed: {
        kind: 'checksum',
        algorithm: 'inet16',
        scope: 'headerAndPayload',
        pseudoHeader: 'ipv6',
      },
      description: 'Internet checksum including the IPv6 pseudo-header.',
    },
    { id: 'identifier', name: 'Identifier', type: 'uint', bitLength: 16, default: 0x1234 },
    { id: 'sequenceNumber', name: 'Sequence Number', type: 'uint', bitLength: 16, default: 1 },
  ],
  providesNamespaces: [
    { id: NS.icmpPayload, displayName: 'quoted datagram', selectorFieldId: null },
  ],
  encapsulations: [{ namespaceId: NS.ipProto, value: 58 }],
};
