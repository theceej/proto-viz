import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { dns } from './dns';

/** Same wire format as DNS; only the port and addressing differ. */
export const mdns: ProtocolDefinition = {
  ...dns,
  id: 'mdns',
  name: 'mDNS',
  fullName: 'Multicast DNS',
  description:
    'Zero-configuration name resolution on the local link (224.0.0.251 / ff02::fb, UDP 5353). The packet format is DNS; names conventionally end in ".local".',
  encapsulations: [{ namespaceId: NS.udpDstPort, value: 5353 }],
};

export const llmnr: ProtocolDefinition = {
  ...dns,
  id: 'llmnr',
  name: 'LLMNR',
  fullName: 'Link-Local Multicast Name Resolution',
  description:
    "Windows' link-local name resolution (224.0.0.252, UDP 5355). DNS wire format with slightly different header-bit semantics.",
  encapsulations: [{ namespaceId: NS.udpDstPort, value: 5355 }],
};
