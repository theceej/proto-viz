import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { E } from '../core/expr';

/** IEEE 802.1X Port Access Entity envelope. */
export const eapol: ProtocolDefinition = {
  id: 'eapol',
  name: 'EAPOL',
  fullName: 'IEEE 802.1X Extensible Authentication Protocol over LAN',
  layerHint: 'link',
  source: 'builtin',
  references: ['IEEE 802.1X'],
  description:
    'The 802.1X LAN envelope carried directly by EtherType 0x888E. Packet type 0 carries an EAP packet; Start, Logoff, Key, and ASF Alert bodies remain opaque payload bytes.',
  fields: [
    { id: 'version', name: 'Protocol Version', type: 'uint', bitLength: 8, default: 2, description: 'EAPOL protocol version; version 2 is used by IEEE 802.1X-2004 and later.' },
    {
      id: 'packetType', name: 'Packet Type', type: 'uint', bitLength: 8, default: 0,
      enumRef: 'eapol-packet-type', computed: { kind: 'binding' },
      description: 'Identifies EAP Packet, Start, Logoff, Key, or ASF Alert; auto-set when EAP follows.',
    },
    {
      id: 'bodyLength', name: 'Packet Body Length', type: 'uint', bitLength: 16,
      computed: { kind: 'expr', expr: E.payloadBytes() },
      description: 'Number of octets following the EAPOL header.',
    },
  ],
  providesNamespaces: [
    { id: NS.eapolPacket, displayName: 'EAPOL packet type', selectorFieldId: 'packetType' },
  ],
  encapsulations: [{ namespaceId: NS.ethertype, value: 0x888e }],
};
