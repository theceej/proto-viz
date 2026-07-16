import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

export const igmp: ProtocolDefinition = {
  id: 'igmp',
  name: 'IGMP',
  fullName: 'Internet Group Management Protocol v2',
  layerHint: 'network',
  source: 'builtin',
  references: ['RFC 2236'],
  description:
    'Multicast group membership signalling between hosts and routers. Defaults model a general membership query.',
  fields: [
    { id: 'type', name: 'Type', type: 'uint', bitLength: 8, default: 0x11, enumRef: 'igmp-type' },
    { id: 'maxRespTime', name: 'Max Resp Time', type: 'uint', bitLength: 8, default: 100, description: 'In tenths of a second.' },
    {
      id: 'checksum',
      name: 'Checksum',
      type: 'uint',
      bitLength: 16,
      computed: { kind: 'checksum', algorithm: 'inet16', scope: 'headerAndPayload' },
    },
    { id: 'groupAddress', name: 'Group Address', type: 'ipv4', bitLength: 32, default: '0.0.0.0', description: 'Zero for a general query.' },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.ipProto, value: 2 }],
};
