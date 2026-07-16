import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

export const vlan8021q: ProtocolDefinition = {
  id: 'vlan-8021q',
  name: '802.1Q VLAN',
  fullName: 'IEEE 802.1Q VLAN tag',
  layerHint: 'link',
  source: 'builtin',
  references: ['IEEE 802.1Q'],
  description:
    'A 4-byte tag inserted after the Ethernet source address. On the wire, the TPID 0x8100 occupies the EtherType position of the outer frame and the tag carries the real EtherType — which is exactly how the stack serializes here. Stack two tags for Q-in-Q.',
  fields: [
    {
      id: 'pcp',
      name: 'PCP',
      type: 'uint',
      bitLength: 3,
      default: 0,
      description: 'Priority Code Point (class of service).',
    },
    {
      id: 'dei',
      name: 'DEI',
      type: 'uint',
      bitLength: 1,
      default: 0,
      description: 'Drop Eligible Indicator.',
    },
    {
      id: 'vid',
      name: 'VLAN ID',
      type: 'uint',
      bitLength: 12,
      default: 100,
      description: 'VLAN identifier (1–4094).',
    },
    {
      id: 'etherType',
      name: 'EtherType',
      type: 'uint',
      bitLength: 16,
      default: 0x0800,
      enumRef: 'ethertype',
      computed: { kind: 'binding' },
      description: 'EtherType of the encapsulated payload (auto-set from the next layer).',
    },
  ],
  providesNamespaces: [
    { id: NS.ethertype, displayName: 'EtherType', selectorFieldId: 'etherType' },
  ],
  encapsulations: [{ namespaceId: NS.ethertype, value: 0x8100 }],
};
