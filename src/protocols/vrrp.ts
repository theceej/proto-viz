import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

export const vrrp: ProtocolDefinition = {
  id: 'vrrp',
  name: 'VRRP',
  fullName: 'Virtual Router Redundancy Protocol (v2)',
  layerHint: 'network',
  source: 'builtin',
  description:
    'First-hop redundancy: routers share a virtual IP, and the highest-priority one answers for it. Sent to multicast 224.0.0.18 with IP protocol 112. Modeled with one virtual address.',
  fields: [
    { id: 'version', name: 'Version', type: 'uint', bitLength: 4, default: 2 },
    { id: 'type', name: 'Type', type: 'uint', bitLength: 4, default: 1, description: '1 = Advertisement (the only type).' },
    { id: 'virtualRtrId', name: 'Virtual Router ID', type: 'uint', bitLength: 8, default: 1 },
    { id: 'priority', name: 'Priority', type: 'uint', bitLength: 8, default: 100, description: '255 = address owner; 0 = master releasing.' },
    { id: 'countIpAddrs', name: 'Count IP Addrs', type: 'uint', bitLength: 8, default: 1 },
    { id: 'authType', name: 'Auth Type', type: 'uint', bitLength: 8, default: 0, description: '0 = no authentication.' },
    { id: 'adverInt', name: 'Advertisement Interval', type: 'uint', bitLength: 8, default: 1, description: 'Seconds between advertisements.' },
    {
      id: 'checksum', name: 'Checksum', type: 'uint', bitLength: 16,
      computed: { kind: 'checksum', algorithm: 'inet16', scope: 'headerAndPayload' },
    },
    { id: 'ipAddress', name: 'IP Address', type: 'ipv4', bitLength: 32, default: '192.0.2.254', description: 'The virtual address being backed up.' },
    { id: 'authData', name: 'Authentication Data', type: 'bytes', bitLength: 64, default: new Uint8Array(8), description: 'Unused with Auth Type 0.' },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.ipProto, value: 112 }],
};
