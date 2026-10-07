import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

export const qinq: ProtocolDefinition = {
  id: 'qinq',
  name: '802.1ad QinQ',
  fullName: 'IEEE 802.1ad service VLAN tag',
  layerHint: 'link',
  source: 'builtin',
  description:
    'A 4-byte service VLAN tag for provider bridging. The preceding Ethernet EtherType supplies the TPID (0x88a8 by default; legacy 0x9100 is also accepted). Place an 802.1Q customer tag after this layer for double tagging, or carry an untagged payload directly. Pin the preceding EtherType to 0x9100 to build the legacy variant.',
  fields: [
    {
      id: 'pcp',
      name: 'Service PCP',
      type: 'uint',
      bitLength: 3,
      default: 0,
      description: 'Service Priority Code Point (class of service).',
    },
    {
      id: 'dei',
      name: 'DEI',
      type: 'uint',
      bitLength: 1,
      default: 0,
      description: 'Service Drop Eligible Indicator.',
    },
    {
      id: 'vid',
      name: 'Service VLAN ID',
      type: 'uint',
      bitLength: 12,
      default: 200,
      description: 'Service VLAN identifier (1–4094); zero denotes a priority tag.',
    },
    {
      id: 'etherType',
      name: 'EtherType',
      type: 'uint',
      bitLength: 16,
      default: 0x8100,
      enumRef: 'ethertype',
      computed: { kind: 'binding' },
      description:
        'Encapsulated EtherType: usually 0x8100 for a customer VLAN tag; auto-set from the next layer.',
    },
  ],
  providesNamespaces: [
    { id: NS.ethertype, displayName: 'EtherType', selectorFieldId: 'etherType' },
  ],
  encapsulations: [
    { namespaceId: NS.ethertype, value: 0x88a8 },
    { namespaceId: NS.ethertype, value: 0x9100 },
  ],
};
