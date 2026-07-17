import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

export const hsrp: ProtocolDefinition = {
  id: 'hsrp',
  name: 'HSRP',
  fullName: 'Hot Standby Router Protocol (v1)',
  layerHint: 'network',
  source: 'builtin',
  references: ['RFC 2281'],
  description:
    "Cisco's first-hop redundancy protocol: hellos to 224.0.0.2 on UDP 1985 elect an active router for the virtual IP.",
  fields: [
    { id: 'version', name: 'Version', type: 'uint', bitLength: 8, default: 0 },
    { id: 'opcode', name: 'Op Code', type: 'uint', bitLength: 8, default: 0, enumRef: 'hsrp-opcode' },
    { id: 'state', name: 'State', type: 'uint', bitLength: 8, default: 16, enumRef: 'hsrp-state' },
    { id: 'helloTime', name: 'Hellotime', type: 'uint', bitLength: 8, default: 3, description: 'Seconds between hellos.' },
    { id: 'holdTime', name: 'Holdtime', type: 'uint', bitLength: 8, default: 10, description: 'Seconds before the active router is declared down.' },
    { id: 'priority', name: 'Priority', type: 'uint', bitLength: 8, default: 100 },
    { id: 'group', name: 'Group', type: 'uint', bitLength: 8, default: 1 },
    { id: 'reserved', name: 'Reserved', type: 'uint', bitLength: 8, default: 0 },
    { id: 'authData', name: 'Authentication Data', type: 'bytes', bitLength: 64, default: new Uint8Array([0x63, 0x69, 0x73, 0x63, 0x6f, 0, 0, 0]), description: 'Cleartext password, default "cisco".' },
    { id: 'virtualIp', name: 'Virtual IP Address', type: 'ipv4', bitLength: 32, default: '192.0.2.254' },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.udpDstPort, value: 1985 }],
};
