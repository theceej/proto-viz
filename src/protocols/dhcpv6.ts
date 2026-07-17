import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

export const dhcpv6: ProtocolDefinition = {
  id: 'dhcpv6',
  name: 'DHCPv6',
  fullName: 'Dynamic Host Configuration Protocol for IPv6',
  layerHint: 'application',
  source: 'builtin',
  references: ['RFC 8415'],
  description:
    'IPv6 address assignment: clients multicast to ff02::1:2 on UDP 547. The fixed header is tiny; everything else is options carried here as raw bytes.',
  fields: [
    { id: 'msgType', name: 'Message Type', type: 'uint', bitLength: 8, default: 1, enumRef: 'dhcpv6-msg-type' },
    { id: 'transactionId', name: 'Transaction ID', type: 'uint', bitLength: 24, default: 0xabcdef },
    { id: 'options', name: 'Options', type: 'bytes', bitLength: 'auto', default: new Uint8Array([0, 8, 0, 2, 0, 0]), description: 'Option TLVs; default is an Elapsed Time option of 0.' },
  ],
  providesNamespaces: [],
  encapsulations: [
    { namespaceId: NS.udpDstPort, value: 547 },
    { namespaceId: NS.udpDstPort, value: 546 },
  ],
};
