import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

export const stp: ProtocolDefinition = {
  id: 'stp',
  name: 'STP',
  fullName: 'Spanning Tree Protocol (Configuration BPDU)',
  layerHint: 'link',
  source: 'builtin',
  description:
    'Bridge Protocol Data Unit that elects the root bridge and breaks loops. Bridge IDs are 2 priority bytes followed by a MAC; times are in 1/256ths of a second.',
  fields: [
    { id: 'protocolId', name: 'Protocol Identifier', type: 'uint', bitLength: 16, default: 0, description: '0 for spanning tree.' },
    { id: 'version', name: 'Version', type: 'uint', bitLength: 8, default: 0, description: '0 = STP, 2 = RSTP.' },
    { id: 'bpduType', name: 'BPDU Type', type: 'uint', bitLength: 8, default: 0, enumRef: 'stp-bpdu-type' },
    {
      id: 'flags', name: 'Flags', type: 'flags', bitLength: 8, default: 0,
      flags: [
        { bit: 0, name: 'TCA', description: 'Topology Change Acknowledgment' },
        { bit: 7, name: 'TC', description: 'Topology Change' },
      ],
    },
    { id: 'rootId', name: 'Root Identifier', type: 'bytes', bitLength: 64, default: new Uint8Array([0x80, 0x00, 0x02, 0, 0, 0, 0, 0x01]), description: 'Priority (0x8000) + root bridge MAC.' },
    { id: 'rootPathCost', name: 'Root Path Cost', type: 'uint', bitLength: 32, default: 0 },
    { id: 'bridgeId', name: 'Bridge Identifier', type: 'bytes', bitLength: 64, default: new Uint8Array([0x80, 0x00, 0x02, 0, 0, 0, 0, 0x01]) },
    { id: 'portId', name: 'Port Identifier', type: 'uint', bitLength: 16, default: 0x8001 },
    { id: 'messageAge', name: 'Message Age', type: 'uint', bitLength: 16, default: 0, description: 'In 1/256 s.' },
    { id: 'maxAge', name: 'Max Age', type: 'uint', bitLength: 16, default: 20 * 256, description: '20 s default.' },
    { id: 'helloTime', name: 'Hello Time', type: 'uint', bitLength: 16, default: 2 * 256, description: '2 s default.' },
    { id: 'forwardDelay', name: 'Forward Delay', type: 'uint', bitLength: 16, default: 15 * 256, description: '15 s default.' },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.llcSap, value: 0x42 }],
};
