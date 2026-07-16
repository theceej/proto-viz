import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { E } from '../core/expr';

const MARKER = new Uint8Array(16).fill(0xff);

export const bgp: ProtocolDefinition = {
  id: 'bgp',
  name: 'BGP',
  fullName: 'Border Gateway Protocol 4 message header',
  layerHint: 'application',
  source: 'builtin',
  references: ['RFC 4271'],
  description:
    'Inter-domain routing over TCP 179. The 19-byte message header is modeled; the default type is KEEPALIVE, which is a complete, valid message on its own. OPEN/UPDATE bodies go in the payload.',
  fields: [
    { id: 'marker', name: 'Marker', type: 'bytes', bitLength: 128, default: MARKER, description: 'All ones for compatibility.' },
    {
      id: 'length',
      name: 'Length',
      type: 'uint',
      bitLength: 16,
      computed: { kind: 'expr', expr: E.add(E.headerBytes(), E.payloadBytes()) },
      description: 'Total message length including this header.',
    },
    { id: 'type', name: 'Type', type: 'uint', bitLength: 8, default: 4, enumRef: 'bgp-type', description: '4 = KEEPALIVE.' },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.tcpDstPort, value: 179 }],
};
