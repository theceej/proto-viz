import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

const CHADDR = new Uint8Array(16);
CHADDR.set([0x02, 0x00, 0x00, 0x00, 0x00, 0x01]);

export const dhcp: ProtocolDefinition = {
  id: 'dhcp',
  name: 'DHCP',
  fullName: 'Dynamic Host Configuration Protocol',
  layerHint: 'application',
  source: 'builtin',
  references: ['RFC 2131'],
  description:
    'IP address assignment over UDP 67/68 using the BOOTP wire format. Defaults model a DISCOVER (option 53 = 1 in the Options field). The large sname/file fields are zero-filled as usual.',
  fields: [
    { id: 'op', name: 'Op', type: 'uint', bitLength: 8, default: 1, enumRef: 'dhcp-op', description: '1 = request (client), 2 = reply (server).' },
    { id: 'htype', name: 'Hardware Type', type: 'uint', bitLength: 8, default: 1, description: '1 = Ethernet.' },
    { id: 'hlen', name: 'Hardware Length', type: 'uint', bitLength: 8, default: 6 },
    { id: 'hops', name: 'Hops', type: 'uint', bitLength: 8, default: 0 },
    { id: 'xid', name: 'Transaction ID', type: 'uint', bitLength: 32, default: 0x3903f326 },
    { id: 'secs', name: 'Seconds', type: 'uint', bitLength: 16, default: 0 },
    {
      id: 'flags',
      name: 'Flags',
      type: 'flags',
      bitLength: 16,
      default: 0,
      flags: [{ bit: 0, name: 'B', description: 'Broadcast reply requested' }],
    },
    { id: 'ciaddr', name: 'Client IP', type: 'ipv4', bitLength: 32, default: '0.0.0.0' },
    { id: 'yiaddr', name: 'Your IP', type: 'ipv4', bitLength: 32, default: '0.0.0.0', description: 'Address offered by the server.' },
    { id: 'siaddr', name: 'Server IP', type: 'ipv4', bitLength: 32, default: '0.0.0.0' },
    { id: 'giaddr', name: 'Gateway IP', type: 'ipv4', bitLength: 32, default: '0.0.0.0' },
    { id: 'chaddr', name: 'Client MAC (padded)', type: 'bytes', bitLength: 128, default: CHADDR, description: 'Hardware address, zero-padded to 16 bytes.' },
    { id: 'sname', name: 'Server Name', type: 'bytes', bitLength: 512, description: '64 bytes, usually zero.' },
    { id: 'file', name: 'Boot File', type: 'bytes', bitLength: 1024, description: '128 bytes, usually zero.' },
    { id: 'magicCookie', name: 'Magic Cookie', type: 'uint', bitLength: 32, default: 0x63825363, description: 'Marks the start of DHCP options.' },
    {
      id: 'options',
      name: 'Options',
      type: 'bytes',
      bitLength: 'auto',
      default: Uint8Array.from([53, 1, 1, 255]),
      description: 'TLV options; default is Message Type = DISCOVER, then End.',
    },
  ],
  providesNamespaces: [],
  encapsulations: [
    { namespaceId: NS.udpDstPort, value: 67 },
    { namespaceId: NS.udpDstPort, value: 68 },
  ],
};
