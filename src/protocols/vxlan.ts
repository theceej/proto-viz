import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

export const vxlan: ProtocolDefinition = {
  id: 'vxlan',
  name: 'VXLAN',
  fullName: 'Virtual eXtensible LAN',
  layerHint: 'tunnel',
  source: 'builtin',
  references: ['RFC 7348'],
  description:
    'Layer-2-over-UDP overlay tunneling (port 4789). The payload is always an inner Ethernet frame, identified by the 24-bit VNI.',
  fields: [
    {
      id: 'flags',
      name: 'Flags',
      type: 'flags',
      bitLength: 8,
      default: 0x08,
      flags: [{ bit: 4, name: 'I', description: 'VNI is valid (must be set)' }],
    },
    { id: 'reserved1', name: 'Reserved', type: 'uint', bitLength: 24, default: 0 },
    { id: 'vni', name: 'VNI', type: 'uint', bitLength: 24, default: 5000, description: 'VXLAN Network Identifier.' },
    { id: 'reserved2', name: 'Reserved', type: 'uint', bitLength: 8, default: 0 },
  ],
  providesNamespaces: [
    { id: NS.vxlanPayload, displayName: 'inner Ethernet frame', selectorFieldId: null },
  ],
  encapsulations: [{ namespaceId: NS.udpDstPort, value: 4789 }],
};
