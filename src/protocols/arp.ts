import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

export const arp: ProtocolDefinition = {
  id: 'arp',
  name: 'ARP',
  fullName: 'Address Resolution Protocol',
  layerHint: 'network',
  source: 'builtin',
  description:
    'Maps IPv4 addresses to link-layer (MAC) addresses. Defaults model a who-has request; the target MAC is zero because it is what the request is asking for.',
  fields: [
    { id: 'htype', name: 'Hardware Type', type: 'uint', bitLength: 16, default: 1, description: '1 = Ethernet.' },
    { id: 'ptype', name: 'Protocol Type', type: 'uint', bitLength: 16, default: 0x0800, enumRef: 'ethertype', description: 'Protocol being resolved (0x0800 = IPv4).' },
    { id: 'hlen', name: 'Hardware Length', type: 'uint', bitLength: 8, default: 6, description: 'MAC address length in bytes.' },
    { id: 'plen', name: 'Protocol Length', type: 'uint', bitLength: 8, default: 4, description: 'IPv4 address length in bytes.' },
    { id: 'oper', name: 'Operation', type: 'uint', bitLength: 16, default: 1, enumRef: 'arp-oper', description: '1 = request, 2 = reply.' },
    { id: 'sha', name: 'Sender MAC', type: 'mac', bitLength: 48, default: '02:00:00:00:00:01' },
    { id: 'spa', name: 'Sender IP', type: 'ipv4', bitLength: 32, default: '192.0.2.1' },
    { id: 'tha', name: 'Target MAC', type: 'mac', bitLength: 48, default: '00:00:00:00:00:00', description: 'Unknown in a request.' },
    { id: 'tpa', name: 'Target IP', type: 'ipv4', bitLength: 32, default: '192.0.2.2' },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.ethertype, value: 0x0806 }],
};
