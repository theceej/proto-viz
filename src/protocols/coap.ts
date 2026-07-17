import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

export const coap: ProtocolDefinition = {
  id: 'coap',
  name: 'CoAP',
  fullName: 'Constrained Application Protocol',
  layerHint: 'application',
  source: 'builtin',
  references: ['RFC 7252'],
  description:
    'REST for constrained devices over UDP 5683. Codes read as class.detail (0.01 = GET, 2.05 = Content); options and payload follow as packet payload.',
  fields: [
    { id: 'version', name: 'Ver', type: 'uint', bitLength: 2, default: 1 },
    { id: 'type', name: 'T', type: 'uint', bitLength: 2, default: 0, description: '0 = Confirmable, 1 = Non-confirmable, 2 = ACK, 3 = Reset.' },
    { id: 'tokenLength', name: 'TKL', type: 'uint', bitLength: 4, default: 0, description: 'Token bytes following the header (0–8).' },
    { id: 'code', name: 'Code', type: 'uint', bitLength: 8, default: 1, enumRef: 'coap-code' },
    { id: 'messageId', name: 'Message ID', type: 'uint', bitLength: 16, default: 1 },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.udpDstPort, value: 5683 }],
};
