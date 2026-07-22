import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { E } from '../core/expr';

/** ISO 10589 Level-1 LAN IIH with a representative editable TLV sequence. */
export const isis: ProtocolDefinition = {
  id: 'isis',
  name: 'IS-IS',
  fullName: 'Intermediate System to Intermediate System (Level-1 LAN IIH)',
  layerHint: 'network',
  source: 'builtin',
  description:
    'Link-state routing carried directly by an IEEE 802.3 LLC frame (DSAP and SSAP 0xFE), not by IP. This models a Level-1 LAN IIH fixed header followed by representative Area Addresses and Protocols Supported TLVs. IS-IS permits an extensible TLV chain, so other TLVs remain editable as raw bytes. Use destination MAC 01:80:c2:00:00:14 for an AllL1IS multicast frame and set the carrier LLC SSAP to 0xFE.',
  fields: [
    { id: 'irpd', name: 'Intradomain Routing Protocol Discriminator', type: 'uint', bitLength: 8, default: 0x83, description: 'NLPID 0x83 identifies IS-IS.' },
    { id: 'headerLength', name: 'Header Length Indicator', type: 'uint', bitLength: 8, default: 27, description: 'Octets in the fixed Level-1 LAN IIH header.' },
    { id: 'protocolIdExtension', name: 'Protocol ID Extension', type: 'uint', bitLength: 8, default: 1 },
    { id: 'idLength', name: 'System ID Length', type: 'uint', bitLength: 8, default: 0, description: '0 denotes the standard six-octet System ID.' },
    { id: 'reservedBeforeType', name: 'Reserved', type: 'uint', bitLength: 3, default: 0 },
    { id: 'pduType', name: 'PDU Type', type: 'uint', bitLength: 5, default: 15, description: '15 = Level-1 LAN IS-to-IS Hello (IIH).' },
    { id: 'version', name: 'Version', type: 'uint', bitLength: 8, default: 1 },
    { id: 'reserved', name: 'Reserved', type: 'uint', bitLength: 8, default: 0 },
    { id: 'maxAreaAddresses', name: 'Maximum Area Addresses', type: 'uint', bitLength: 8, default: 0, description: '0 denotes the ISO 10589 default of three areas.' },
    { id: 'reservedCircuit', name: 'Reserved', type: 'uint', bitLength: 6, default: 0 },
    { id: 'circuitType', name: 'Circuit Type', type: 'uint', bitLength: 2, default: 1, description: '1 = Level 1; 2 = Level 2; 3 = both.' },
    { id: 'sourceId', name: 'Source System ID', type: 'bytes', bitLength: 48, default: new Uint8Array([0x02, 0, 0, 0, 0, 1]), description: 'Six-octet originating system identifier.' },
    { id: 'holdingTimer', name: 'Holding Timer', type: 'uint', bitLength: 16, default: 30, description: 'Seconds before this adjacency expires.' },
    {
      id: 'pduLength',
      name: 'PDU Length',
      type: 'uint',
      bitLength: 16,
      computed: { kind: 'expr', expr: E.add(E.headerBytes(), E.payloadBytes()) },
      description: 'Entire IS-IS PDU, including the fixed header and TLVs.',
    },
    { id: 'reservedPriority', name: 'Reserved', type: 'uint', bitLength: 1, default: 0 },
    { id: 'priority', name: 'Priority', type: 'uint', bitLength: 7, default: 64, description: 'Designated IS election priority.' },
    { id: 'lanId', name: 'LAN ID', type: 'bytes', bitLength: 56, default: new Uint8Array([0x02, 0, 0, 0, 0, 1, 1]), description: 'Designated IS System ID plus one-octet pseudonode ID.' },
    {
      id: 'tlvs',
      name: 'TLVs',
      type: 'bytes',
      bitLength: 'auto',
      default: new Uint8Array([0x01, 0x04, 0x03, 0x49, 0x00, 0x01, 0x81, 0x01, 0xcc]),
      description: 'Representative Area Addresses TLV (area 49.0001) and Protocols Supported TLV (IPv4 NLPID 0xCC); edit as raw TLV bytes for other capabilities.',
    },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.llcSap, value: 0xfe }],
};
