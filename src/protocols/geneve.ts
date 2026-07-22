import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

export const geneve: ProtocolDefinition = {
  id: 'geneve',
  name: 'GENEVE',
  fullName: 'Generic Network Virtualization Encapsulation',
  layerHint: 'tunnel',
  source: 'builtin',
  description:
    "VXLAN's successor for overlay networks (UDP 6081): the same VNI idea plus an EtherType-coded protocol field and extensible options, so it can carry more than Ethernet.",
  fields: [
    { id: 'version', name: 'Ver', type: 'uint', bitLength: 2, default: 0 },
    { id: 'optLen', name: 'Opt Len', type: 'uint', bitLength: 6, default: 0, description: 'Options length in 4-byte multiples (none modeled).' },
    { id: 'oam', name: 'O', type: 'uint', bitLength: 1, default: 0, description: 'Control packet (OAM).' },
    { id: 'critical', name: 'C', type: 'uint', bitLength: 1, default: 0, description: 'Critical options present.' },
    { id: 'reserved', name: 'Rsvd', type: 'uint', bitLength: 6, default: 0 },
    { id: 'protocolType', name: 'Protocol Type', type: 'uint', bitLength: 16, default: 0x6558, enumRef: 'ethertype', computed: { kind: 'binding' }, description: 'EtherType of the inner payload (auto-set; 0x6558 = Ethernet).' },
    { id: 'vni', name: 'VNI', type: 'uint', bitLength: 24, default: 100, description: 'Virtual Network Identifier.' },
    { id: 'reserved2', name: 'Reserved', type: 'uint', bitLength: 8, default: 0 },
  ],
  providesNamespaces: [
    { id: NS.greProto, displayName: 'Protocol Type', selectorFieldId: 'protocolType' },
  ],
  encapsulations: [{ namespaceId: NS.udpDstPort, value: 6081 }],
};
