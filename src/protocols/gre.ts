import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { E } from '../core/expr';

export const gre: ProtocolDefinition = {
  id: 'gre',
  name: 'GRE',
  fullName: 'Generic Routing Encapsulation',
  layerHint: 'tunnel',
  source: 'builtin',
  references: ['RFC 2784'],
  description:
    'Simple IP tunneling. The Protocol Type field uses EtherType values and is auto-set from the inner layer. Enable the C bit to add the optional checksum.',
  fields: [
    { id: 'checksumPresent', name: 'C', type: 'uint', bitLength: 1, default: 0, description: '1 = checksum and reserved fields present.' },
    { id: 'reserved0', name: 'Reserved0', type: 'uint', bitLength: 12, default: 0 },
    { id: 'version', name: 'Version', type: 'uint', bitLength: 3, default: 0 },
    {
      id: 'protocolType',
      name: 'Protocol Type',
      type: 'uint',
      bitLength: 16,
      default: 0x0800,
      enumRef: 'ethertype',
      computed: { kind: 'binding' },
      description: 'EtherType of the tunneled payload (auto-set).',
    },
    {
      id: 'checksum',
      name: 'Checksum',
      type: 'uint',
      bitLength: 16,
      presentIf: E.field('checksumPresent'),
      computed: { kind: 'checksum', algorithm: 'inet16', scope: 'headerAndPayload' },
      description: 'Optional; over GRE header and payload.',
    },
    {
      id: 'reserved1',
      name: 'Reserved1',
      type: 'uint',
      bitLength: 16,
      default: 0,
      presentIf: E.field('checksumPresent'),
    },
  ],
  providesNamespaces: [
    { id: NS.greProto, displayName: 'GRE Protocol Type', selectorFieldId: 'protocolType' },
  ],
  encapsulations: [{ namespaceId: NS.ipProto, value: 47 }],
};
