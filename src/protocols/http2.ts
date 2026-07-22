import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { E } from '../core/expr';

export const http2: ProtocolDefinition = {
  id: 'http2',
  name: 'HTTP/2',
  fullName: 'HTTP/2 frame',
  layerHint: 'application',
  source: 'builtin',
  description:
    'Binary framing for multiplexed HTTP. Every frame starts with this 9-byte header; the payload is the frame body (HEADERS bodies are HPACK-compressed). Normally inside TLS via ALPN "h2".',
  fields: [
    {
      id: 'length', name: 'Length', type: 'uint', bitLength: 24,
      computed: { kind: 'expr', expr: E.payloadBytes() },
      description: 'Frame payload length after this header.',
    },
    { id: 'type', name: 'Type', type: 'uint', bitLength: 8, default: 0, enumRef: 'http2-frame-type' },
    { id: 'frameFlags', name: 'Flags', type: 'uint', bitLength: 8, default: 1, description: 'Meaning depends on frame type; 0x1 = END_STREAM on DATA.' },
    { id: 'reserved', name: 'R', type: 'uint', bitLength: 1, default: 0 },
    { id: 'streamId', name: 'Stream Identifier', type: 'uint', bitLength: 31, default: 1, description: 'Odd for client-initiated streams; 0 = connection control.' },
  ],
  providesNamespaces: [],
  encapsulations: [
    { namespaceId: NS.tlsPayload },
    { namespaceId: NS.tcpDstPort, value: 80 },
  ],
};
