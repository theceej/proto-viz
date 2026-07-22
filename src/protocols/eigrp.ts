import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

export const eigrp: ProtocolDefinition = {
  id: 'eigrp',
  name: 'EIGRP',
  fullName: 'Enhanced Interior Gateway Routing Protocol',
  layerHint: 'network',
  source: 'builtin',
  description:
    'Advanced distance-vector routing (IP protocol 88, multicast 224.0.0.10). This is the common 20-byte header; TLVs follow as payload.',
  fields: [
    { id: 'version', name: 'Version', type: 'uint', bitLength: 8, default: 2 },
    { id: 'opcode', name: 'Opcode', type: 'uint', bitLength: 8, default: 5, enumRef: 'eigrp-opcode' },
    {
      id: 'checksum', name: 'Checksum', type: 'uint', bitLength: 16,
      computed: { kind: 'checksum', algorithm: 'inet16', scope: 'headerAndPayload' },
    },
    { id: 'flags', name: 'Flags', type: 'uint', bitLength: 32, default: 0 },
    { id: 'sequence', name: 'Sequence', type: 'uint', bitLength: 32, default: 0 },
    { id: 'acknowledge', name: 'Acknowledge', type: 'uint', bitLength: 32, default: 0 },
    { id: 'virtualRouterId', name: 'Virtual Router ID', type: 'uint', bitLength: 16, default: 0 },
    { id: 'asNumber', name: 'Autonomous System', type: 'uint', bitLength: 16, default: 1 },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.ipProto, value: 88 }],
};
