import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

/** MLDv2 Multicast Listener Report (RFC 3810 §5.2) — the IPv6 analogue of an
 *  IGMPv3 report, carried as ICMPv6 type 143. Modeled with one address record. */
export const mldv2: ProtocolDefinition = {
  id: 'mldv2',
  name: 'MLDv2',
  fullName: 'Multicast Listener Discovery v2 Report',
  layerHint: 'network',
  source: 'builtin',
  description:
    "IPv6 multicast membership reporting, MLDv2's answer to IGMPv3. It rides on ICMPv6 (type 143) and, like IGMPv3, carries Multicast Address Records with per-group source lists. Modeled with one record and one source; the checksum covers the IPv6 pseudo-header.",
  fields: [
    { id: 'type', name: 'Type', type: 'uint', bitLength: 8, default: 143, enumRef: 'icmpv6-type', description: '143 = MLDv2 Multicast Listener Report.' },
    { id: 'reserved1', name: 'Reserved', type: 'uint', bitLength: 8, default: 0 },
    {
      id: 'checksum',
      name: 'Checksum',
      type: 'uint',
      bitLength: 16,
      computed: { kind: 'checksum', algorithm: 'inet16', scope: 'headerAndPayload', pseudoHeader: 'ipv6' },
      description: 'Internet checksum including the IPv6 pseudo-header.',
    },
    { id: 'reserved2', name: 'Reserved', type: 'uint', bitLength: 16, default: 0 },
    { id: 'numRecords', name: 'Number of Address Records', type: 'uint', bitLength: 16, default: 1 },
    { id: 'recordType', name: 'Record Type', type: 'uint', bitLength: 8, default: 2, enumRef: 'igmpv3-record-type', description: 'How to interpret the source list (mode / change / allow / block).' },
    { id: 'auxDataLen', name: 'Aux Data Len', type: 'uint', bitLength: 8, default: 0, description: 'Auxiliary data length in 32-bit words (0 here).' },
    { id: 'numSources', name: 'Number of Sources', type: 'uint', bitLength: 16, default: 1 },
    { id: 'multicastAddress', name: 'Multicast Address', type: 'ipv6', bitLength: 128, default: 'ff3e::1234', description: 'The group being reported (ff3e::/32 is source-specific).' },
    { id: 'sourceAddress', name: 'Source Address [1]', type: 'ipv6', bitLength: 128, default: '2001:db8::1', description: 'A source for source-specific multicast.' },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.ipProto, value: 58 }],
};
