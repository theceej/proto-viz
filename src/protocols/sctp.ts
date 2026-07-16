import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

export const sctp: ProtocolDefinition = {
  id: 'sctp',
  name: 'SCTP',
  fullName: 'Stream Control Transmission Protocol',
  layerHint: 'transport',
  source: 'builtin',
  references: ['RFC 4960'],
  description:
    'Message-oriented transport with multi-streaming. Only the 12-byte common header is modeled; chunks go in the payload. The CRC32c checksum covers the whole packet and is stored byte-swapped per RFC 4960 appendix B.',
  fields: [
    { id: 'srcPort', name: 'Source Port', type: 'uint', bitLength: 16, default: 49152 },
    { id: 'dstPort', name: 'Destination Port', type: 'uint', bitLength: 16, default: 80 },
    { id: 'verificationTag', name: 'Verification Tag', type: 'uint', bitLength: 32, default: 0x1a2b3c4d, description: 'Set on association setup; 0 only in INIT.' },
    {
      id: 'checksum',
      name: 'Checksum',
      type: 'uint',
      bitLength: 32,
      computed: {
        kind: 'checksum',
        algorithm: 'crc32c',
        scope: 'headerAndPayload',
        littleEndian: true,
      },
      description: 'CRC32c over the whole SCTP packet.',
    },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.ipProto, value: 132 }],
};
