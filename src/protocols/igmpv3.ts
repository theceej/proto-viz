import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

/** IGMPv3 Membership Report (RFC 3376 §4.2), modeled with one group record. */
export const igmpv3: ProtocolDefinition = {
  id: 'igmpv3',
  name: 'IGMPv3',
  fullName: 'IGMP v3 Membership Report',
  layerHint: 'network',
  source: 'builtin',
  description:
    'The IGMPv3 report a host sends to declare its multicast interests (IP protocol 2, type 0x22). Unlike the v2 join, v3 carries a list of Group Records, each naming a multicast group and a source-address list for source-specific multicast. Modeled with a single group record and one source; real reports carry a variable number of both.',
  fields: [
    { id: 'type', name: 'Type', type: 'uint', bitLength: 8, default: 0x22, enumRef: 'igmp-type', description: '0x22 = v3 membership report.' },
    { id: 'reserved1', name: 'Reserved', type: 'uint', bitLength: 8, default: 0 },
    {
      id: 'checksum',
      name: 'Checksum',
      type: 'uint',
      bitLength: 16,
      computed: { kind: 'checksum', algorithm: 'inet16', scope: 'headerAndPayload' },
    },
    { id: 'reserved2', name: 'Reserved', type: 'uint', bitLength: 16, default: 0 },
    { id: 'numGroupRecords', name: 'Number of Group Records', type: 'uint', bitLength: 16, default: 1 },
    { id: 'recordType', name: 'Record Type', type: 'uint', bitLength: 8, default: 2, enumRef: 'igmpv3-record-type', description: 'How to interpret the source list (mode / change / allow / block).' },
    { id: 'auxDataLen', name: 'Aux Data Len', type: 'uint', bitLength: 8, default: 0, description: 'Auxiliary data length in 32-bit words (0 here).' },
    { id: 'numSources', name: 'Number of Sources', type: 'uint', bitLength: 16, default: 1 },
    { id: 'multicastAddress', name: 'Multicast Address', type: 'ipv4', bitLength: 32, default: '239.1.1.1', description: 'The group being reported.' },
    { id: 'sourceAddress', name: 'Source Address [1]', type: 'ipv4', bitLength: 32, default: '192.0.2.1', description: 'A source for source-specific multicast.' },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.ipProto, value: 2 }],
};
