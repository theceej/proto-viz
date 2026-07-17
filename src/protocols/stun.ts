import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { E } from '../core/expr';

export const stun: ProtocolDefinition = {
  id: 'stun',
  name: 'STUN',
  fullName: 'Session Traversal Utilities for NAT',
  layerHint: 'application',
  source: 'builtin',
  references: ['RFC 8489'],
  description:
    'NAT discovery used by WebRTC and VoIP. The magic cookie 0x2112A442 distinguishes STUN from other traffic on the same port; attributes ride as payload.',
  fields: [
    { id: 'messageType', name: 'Message Type', type: 'uint', bitLength: 16, default: 0x0001, enumRef: 'stun-type', description: 'Two leading zero bits, then class and method.' },
    {
      id: 'messageLength', name: 'Message Length', type: 'uint', bitLength: 16,
      computed: { kind: 'expr', expr: E.payloadBytes() },
      description: 'Length of the attributes after the 20-byte header.',
    },
    { id: 'magicCookie', name: 'Magic Cookie', type: 'uint', bitLength: 32, default: 0x2112a442 },
    { id: 'transactionId', name: 'Transaction ID', type: 'bytes', bitLength: 96, default: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.udpDstPort, value: 3478 }],
};
