import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

export const dns: ProtocolDefinition = {
  id: 'dns',
  name: 'DNS',
  fullName: 'Domain Name System',
  layerHint: 'application',
  source: 'builtin',
  references: ['RFC 1035'],
  description:
    'Name resolution. The header flag bits are modeled individually; one question is included (name encoded as uncompressed labels). Answer/authority/additional records go in the Records field as raw bytes.',
  notes:
    'Name compression is not used on encode (legal per RFC 1035). Record sections are raw bytes rather than structured fields.',
  fields: [
    { id: 'id', name: 'Transaction ID', type: 'uint', bitLength: 16, default: 0x1234, description: 'Matches responses to queries.' },
    { id: 'qr', name: 'QR', type: 'uint', bitLength: 1, default: 0, description: '0 = query, 1 = response.' },
    { id: 'opcode', name: 'Opcode', type: 'uint', bitLength: 4, default: 0, description: '0 = standard query.' },
    { id: 'aa', name: 'AA', type: 'uint', bitLength: 1, default: 0, description: 'Authoritative answer.' },
    { id: 'tc', name: 'TC', type: 'uint', bitLength: 1, default: 0, description: 'Truncated.' },
    { id: 'rd', name: 'RD', type: 'uint', bitLength: 1, default: 1, description: 'Recursion desired.' },
    { id: 'ra', name: 'RA', type: 'uint', bitLength: 1, default: 0, description: 'Recursion available.' },
    { id: 'z', name: 'Z', type: 'uint', bitLength: 3, default: 0, description: 'Reserved.' },
    { id: 'rcode', name: 'RCODE', type: 'uint', bitLength: 4, default: 0, description: '0 = no error.' },
    { id: 'qdcount', name: 'QDCOUNT', type: 'uint', bitLength: 16, default: 1, description: 'Questions.' },
    { id: 'ancount', name: 'ANCOUNT', type: 'uint', bitLength: 16, default: 0, description: 'Answer records.' },
    { id: 'nscount', name: 'NSCOUNT', type: 'uint', bitLength: 16, default: 0, description: 'Authority records.' },
    { id: 'arcount', name: 'ARCOUNT', type: 'uint', bitLength: 16, default: 0, description: 'Additional records.' },
    { id: 'qname', name: 'Question Name', type: 'dnsName', bitLength: 'auto', default: 'example.com', description: 'Encoded as length-prefixed labels.' },
    { id: 'qtype', name: 'Question Type', type: 'uint', bitLength: 16, default: 1, enumRef: 'dns-type' },
    { id: 'qclass', name: 'Question Class', type: 'uint', bitLength: 16, default: 1, enumRef: 'dns-class' },
    { id: 'records', name: 'Records', type: 'bytes', bitLength: 'auto', default: new Uint8Array(0), description: 'Raw answer/authority/additional sections.' },
  ],
  providesNamespaces: [],
  encapsulations: [
    { namespaceId: NS.udpDstPort, value: 53 },
    { namespaceId: NS.tcpDstPort, value: 53 },
  ],
};
