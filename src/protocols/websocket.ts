import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { E } from '../core/expr';

/** Short unmasked server frame; 16/64-bit lengths and masking omitted. */
export const websocket: ProtocolDefinition = {
  id: 'websocket',
  name: 'WebSocket',
  fullName: 'WebSocket frame',
  layerHint: 'application',
  source: 'builtin',
  references: ['RFC 6455'],
  description:
    'Framing that follows the HTTP Upgrade handshake on the same TCP connection. Modeled as an unmasked server frame with a 7-bit length, so payloads up to 125 bytes; client frames would set Mask and carry a masking key.',
  fields: [
    { id: 'fin', name: 'FIN', type: 'uint', bitLength: 1, default: 1, description: 'Final fragment of the message.' },
    { id: 'rsv', name: 'RSV', type: 'uint', bitLength: 3, default: 0 },
    { id: 'opcode', name: 'Opcode', type: 'uint', bitLength: 4, default: 1, enumRef: 'websocket-opcode' },
    { id: 'mask', name: 'Mask', type: 'uint', bitLength: 1, default: 0, description: '1 on client-to-server frames (masking key would follow).' },
    {
      id: 'payloadLen', name: 'Payload Len', type: 'uint', bitLength: 7,
      computed: { kind: 'expr', expr: E.payloadBytes() },
      description: '7-bit length; 126/127 escape to wider fields not modeled here.',
    },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.tcpDstPort, value: 80 }],
};
