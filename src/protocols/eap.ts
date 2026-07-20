import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { E } from '../core/expr';

/** Representative EAP Response/Identity packet. */
export const eap: ProtocolDefinition = {
  id: 'eap',
  name: 'EAP',
  fullName: 'Extensible Authentication Protocol (Response/Identity)',
  layerHint: 'application',
  source: 'builtin',
  references: ['RFC 3748'],
  description:
    'The authentication exchange carried by EAPOL and other lower layers. This definition models a Response/Identity packet, including its variable identity text. Other Request/Response method data can be edited in the body; Success and Failure packets contain only the first four bytes, a shape not represented by this template.',
  fields: [
    { id: 'code', name: 'Code', type: 'uint', bitLength: 8, default: 2, enumRef: 'eap-code', description: '2 = Response for this representative Identity packet.' },
    { id: 'identifier', name: 'Identifier', type: 'uint', bitLength: 8, default: 1, description: 'Matches a Response to its Request.' },
    {
      id: 'length', name: 'Length', type: 'uint', bitLength: 16,
      computed: { kind: 'expr', expr: E.add(E.headerBytes(), E.payloadBytes()) },
      description: 'Entire EAP packet in octets.',
    },
    { id: 'type', name: 'Type', type: 'uint', bitLength: 8, default: 1, enumRef: 'eap-type', description: '1 = Identity.' },
    { id: 'identity', name: 'Identity', type: 'string', bitLength: 'auto', default: 'proto-viz', description: 'Peer identity carried by this Response/Identity example.' },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.eapolPacket, value: 0 }],
};
