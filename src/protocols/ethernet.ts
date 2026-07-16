import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

export const ethernet: ProtocolDefinition = {
  id: 'ethernet',
  name: 'Ethernet II',
  fullName: 'Ethernet II (DIX) frame',
  layerHint: 'link',
  source: 'builtin',
  references: ['IEEE 802.3'],
  description:
    'The dominant link-layer framing on wired networks. The EtherType field selects the payload protocol. The frame check sequence (FCS) is omitted, matching what packet captures normally record.',
  fields: [
    {
      id: 'dst',
      name: 'Destination MAC',
      type: 'mac',
      bitLength: 48,
      default: '02:00:00:00:00:02',
      description: 'Hardware address of the receiving interface.',
    },
    {
      id: 'src',
      name: 'Source MAC',
      type: 'mac',
      bitLength: 48,
      default: '02:00:00:00:00:01',
      description: 'Hardware address of the sending interface.',
    },
    {
      id: 'etherType',
      name: 'EtherType',
      type: 'uint',
      bitLength: 16,
      default: 0x0800,
      enumRef: 'ethertype',
      computed: { kind: 'binding' },
      description: 'Identifies the payload protocol (auto-set from the next layer).',
    },
  ],
  providesNamespaces: [
    { id: NS.ethertype, displayName: 'EtherType', selectorFieldId: 'etherType' },
  ],
  encapsulations: [
    // Inner Ethernet frames appear inside tunnels.
    { namespaceId: NS.vxlanPayload },
    { namespaceId: NS.greProto, value: 0x6558 }, // Transparent Ethernet Bridging
  ],
};
