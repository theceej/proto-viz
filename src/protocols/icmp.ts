import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

export const icmp: ProtocolDefinition = {
  id: 'icmp',
  name: 'ICMP',
  fullName: 'Internet Control Message Protocol',
  layerHint: 'network',
  source: 'builtin',
  description:
    'Control and error messages for IPv4. Defaults model an echo request (ping); error messages quote the offending datagram as payload.',
  fields: [
    {
      id: 'type',
      name: 'Type',
      type: 'uint',
      bitLength: 8,
      default: 8,
      enumRef: 'icmp-type',
      description: 'Message type (8 = echo request).',
    },
    {
      id: 'code',
      name: 'Code',
      type: 'uint',
      bitLength: 8,
      default: 0,
      description: 'Sub-type qualifier.',
    },
    {
      id: 'checksum',
      name: 'Checksum',
      type: 'uint',
      bitLength: 16,
      computed: { kind: 'checksum', algorithm: 'inet16', scope: 'headerAndPayload' },
      description: 'Internet checksum over the ICMP message.',
    },
    {
      id: 'identifier',
      name: 'Identifier',
      type: 'uint',
      bitLength: 16,
      default: 0x1234,
      description: 'Matches echo requests with replies.',
    },
    {
      id: 'sequenceNumber',
      name: 'Sequence Number',
      type: 'uint',
      bitLength: 16,
      default: 1,
      description: 'Incremented per echo request.',
    },
  ],
  providesNamespaces: [
    // ICMP error messages quote the offending IP datagram.
    { id: NS.icmpPayload, displayName: 'quoted datagram', selectorFieldId: null },
  ],
  encapsulations: [{ namespaceId: NS.ipProto, value: 1 }],
};
