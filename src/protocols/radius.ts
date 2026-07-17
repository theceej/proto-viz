import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { E } from '../core/expr';

export const radius: ProtocolDefinition = {
  id: 'radius',
  name: 'RADIUS',
  fullName: 'Remote Authentication Dial In User Service',
  layerHint: 'application',
  source: 'builtin',
  references: ['RFC 2865'],
  description:
    'AAA protocol on UDP 1812. Attributes (username, NAS address, …) are TLVs carried here as payload; Length covers the whole datagram.',
  fields: [
    { id: 'code', name: 'Code', type: 'uint', bitLength: 8, default: 1, enumRef: 'radius-code' },
    { id: 'identifier', name: 'Identifier', type: 'uint', bitLength: 8, default: 1, description: 'Matches replies to requests.' },
    {
      id: 'length', name: 'Length', type: 'uint', bitLength: 16,
      computed: { kind: 'expr', expr: E.add(E.headerBytes(), E.payloadBytes()) },
    },
    { id: 'authenticator', name: 'Authenticator', type: 'bytes', bitLength: 128, default: new Uint8Array(16), description: 'Random in requests; MD5 over the reply otherwise.' },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.udpDstPort, value: 1812 }],
};
