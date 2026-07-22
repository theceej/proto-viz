import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { E } from '../core/expr';

export const ipsecEsp: ProtocolDefinition = {
  id: 'ipsec-esp',
  name: 'IPsec ESP',
  fullName: 'Encapsulating Security Payload',
  layerHint: 'tunnel',
  source: 'builtin',
  description:
    'Encrypted IPsec payload (IP protocol 50). Only the SPI and sequence number are visible on the wire — everything after them is ciphertext, so nothing can layer inside.',
  fields: [
    { id: 'spi', name: 'Security Parameters Index', type: 'uint', bitLength: 32, default: 0x1000, description: 'Selects the security association.' },
    { id: 'sequenceNumber', name: 'Sequence Number', type: 'uint', bitLength: 32, default: 1, description: 'Anti-replay counter.' },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.ipProto, value: 50 }],
};

export const ipsecAh: ProtocolDefinition = {
  id: 'ipsec-ah',
  name: 'IPsec AH',
  fullName: 'Authentication Header',
  layerHint: 'tunnel',
  source: 'builtin',
  description:
    'Integrity protection without encryption (IP protocol 51). Next Header selects the protected payload, so protocols can layer inside; the ICV is modeled as 12 zero bytes.',
  fields: [
    { id: 'nextHeader', name: 'Next Header', type: 'uint', bitLength: 8, default: 6, enumRef: 'ip-proto', computed: { kind: 'binding' }, description: 'Protocol of the authenticated payload (auto-set).' },
    {
      id: 'payloadLen', name: 'Payload Len', type: 'uint', bitLength: 8,
      computed: { kind: 'expr', expr: E.sub(E.div(E.headerBytes(), E.const(4)), E.const(2)) },
      description: 'AH length in 32-bit words, minus 2.',
    },
    { id: 'reserved', name: 'Reserved', type: 'uint', bitLength: 16, default: 0 },
    { id: 'spi', name: 'Security Parameters Index', type: 'uint', bitLength: 32, default: 0x1000 },
    { id: 'sequenceNumber', name: 'Sequence Number', type: 'uint', bitLength: 32, default: 1 },
    { id: 'icv', name: 'Integrity Check Value', type: 'bytes', bitLength: 96, default: new Uint8Array(12), description: 'Truncated HMAC (96 bits typical).' },
  ],
  providesNamespaces: [
    { id: NS.ipProto, displayName: 'Next Header', selectorFieldId: 'nextHeader' },
  ],
  encapsulations: [{ namespaceId: NS.ipProto, value: 51 }],
};
