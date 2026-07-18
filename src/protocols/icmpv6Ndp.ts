import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

/** Fixed Neighbor Solicitation/Advertisement layout from RFC 4861 sections 4.3/4.4. */
export const icmpv6Ndp: ProtocolDefinition = {
  id: 'icmpv6-ndp',
  name: 'ICMPv6 NDP',
  fullName: 'ICMPv6 Neighbor Discovery',
  layerHint: 'network',
  source: 'builtin',
  references: ['RFC 4861'],
  description:
    'Neighbor Solicitation or Advertisement with one link-layer-address option. Solicitation uses type 135, zero flags, and option type 1; Advertisement uses type 136, R/S/O flags, and option type 2.',
  fields: [
    {
      id: 'type',
      name: 'Type',
      type: 'uint',
      bitLength: 8,
      default: 135,
      enumRef: 'icmpv6-type',
      description: '135 = Neighbor Solicitation, 136 = Neighbor Advertisement.',
    },
    { id: 'code', name: 'Code', type: 'uint', bitLength: 8, default: 0 },
    {
      id: 'checksum',
      name: 'Checksum',
      type: 'uint',
      bitLength: 16,
      computed: {
        kind: 'checksum',
        algorithm: 'inet16',
        scope: 'headerAndPayload',
        pseudoHeader: 'ipv6',
      },
      description: 'Internet checksum including the IPv6 pseudo-header.',
    },
    {
      id: 'flagsReserved',
      name: 'R/S/O Flags + Reserved',
      type: 'flags',
      bitLength: 32,
      default: 0,
      flags: [
        { bit: 0, name: 'R', description: 'Router flag (Advertisement only).' },
        { bit: 1, name: 'S', description: 'Solicited flag (Advertisement only).' },
        { bit: 2, name: 'O', description: 'Override flag (Advertisement only).' },
      ],
      description: 'All zero for Solicitation; high R/S/O bits are used by Advertisement.',
    },
    {
      id: 'targetAddress',
      name: 'Target Address',
      type: 'ipv6',
      bitLength: 128,
      default: '2001:db8::2',
      description: 'IPv6 address whose link-layer address is being resolved or advertised.',
    },
    {
      id: 'optionType',
      name: 'Option Type',
      type: 'uint',
      bitLength: 8,
      default: 1,
      description: '1 = Source Link-Layer Address; 2 = Target Link-Layer Address.',
    },
    {
      id: 'optionLength',
      name: 'Option Length',
      type: 'uint',
      bitLength: 8,
      default: 1,
      description: 'Option length in units of 8 octets.',
    },
    {
      id: 'linkLayerAddress',
      name: 'Link-Layer Address',
      type: 'mac',
      bitLength: 48,
      default: '02:00:00:00:00:01',
    },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.ipProto, value: 58 }],
};
