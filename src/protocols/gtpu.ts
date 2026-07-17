import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { E } from '../core/expr';

export const gtpu: ProtocolDefinition = {
  id: 'gtpu',
  name: 'GTP-U',
  fullName: 'GPRS Tunnelling Protocol (user plane)',
  layerHint: 'tunnel',
  source: 'builtin',
  references: ['3GPP TS 29.281'],
  description:
    'How mobile networks carry subscriber traffic between base station and core (UDP 2152). The TEID identifies the bearer; the payload is the subscriber IP packet.',
  fields: [
    { id: 'version', name: 'Version', type: 'uint', bitLength: 3, default: 1 },
    { id: 'protocolType', name: 'PT', type: 'uint', bitLength: 1, default: 1, description: '1 = GTP, 0 = GTP′.' },
    { id: 'reserved', name: 'R', type: 'uint', bitLength: 1, default: 0 },
    { id: 'extensionFlag', name: 'E', type: 'uint', bitLength: 1, default: 0 },
    { id: 'seqFlag', name: 'S', type: 'uint', bitLength: 1, default: 0 },
    { id: 'npduFlag', name: 'PN', type: 'uint', bitLength: 1, default: 0 },
    { id: 'messageType', name: 'Message Type', type: 'uint', bitLength: 8, default: 255, description: '255 = G-PDU (tunnelled user data).' },
    {
      id: 'length', name: 'Length', type: 'uint', bitLength: 16,
      computed: { kind: 'expr', expr: E.payloadBytes() },
      description: 'Payload bytes after the 8-byte mandatory header.',
    },
    { id: 'teid', name: 'TEID', type: 'uint', bitLength: 32, default: 1, description: 'Tunnel Endpoint Identifier.' },
  ],
  providesNamespaces: [
    { id: NS.gtpPayload, displayName: 'tunnelled IP packet', selectorFieldId: null },
  ],
  encapsulations: [{ namespaceId: NS.udpDstPort, value: 2152 }],
};
