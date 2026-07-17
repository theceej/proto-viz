import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

/** The three mandatory TLVs plus the end marker; optional TLVs go in the payload. */
export const lldp: ProtocolDefinition = {
  id: 'lldp',
  name: 'LLDP',
  fullName: 'Link Layer Discovery Protocol',
  layerHint: 'link',
  source: 'builtin',
  references: ['IEEE 802.1AB'],
  description:
    'Neighbour discovery advertisement. Modeled as the mandatory Chassis ID, Port ID, and TTL TLVs followed by the End TLV; each TLV header is a 7-bit type and 9-bit length. Optional TLVs can be appended as payload before the End TLV in a real frame.',
  fields: [
    { id: 'chassisTlvType', name: 'Chassis TLV Type', type: 'uint', bitLength: 7, default: 1 },
    { id: 'chassisTlvLen', name: 'Chassis TLV Length', type: 'uint', bitLength: 9, default: 7, description: 'Subtype byte + ID (7 for a MAC).' },
    { id: 'chassisSubtype', name: 'Chassis ID Subtype', type: 'uint', bitLength: 8, default: 4, description: '4 = MAC address.' },
    { id: 'chassisId', name: 'Chassis ID', type: 'mac', bitLength: 48, default: '02:00:00:00:00:01' },
    { id: 'portTlvType', name: 'Port TLV Type', type: 'uint', bitLength: 7, default: 2 },
    { id: 'portTlvLen', name: 'Port TLV Length', type: 'uint', bitLength: 9, default: 7 },
    { id: 'portSubtype', name: 'Port ID Subtype', type: 'uint', bitLength: 8, default: 3, description: '3 = MAC address.' },
    { id: 'portId', name: 'Port ID', type: 'mac', bitLength: 48, default: '02:00:00:00:00:01' },
    { id: 'ttlTlvType', name: 'TTL TLV Type', type: 'uint', bitLength: 7, default: 3 },
    { id: 'ttlTlvLen', name: 'TTL TLV Length', type: 'uint', bitLength: 9, default: 2 },
    { id: 'ttl', name: 'Time To Live', type: 'uint', bitLength: 16, default: 120, description: 'Seconds this advertisement stays valid.' },
    { id: 'endTlv', name: 'End of LLDPDU', type: 'uint', bitLength: 16, default: 0, description: 'Type 0, length 0.' },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.ethertype, value: 0x88cc }],
};
