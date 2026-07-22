import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

export const quic: ProtocolDefinition = {
  id: 'quic',
  name: 'QUIC',
  fullName: 'QUIC v1 long header (Initial)',
  layerHint: 'application',
  source: 'builtin',
  description:
    'The transport under HTTP/3 (UDP 443). Modeled as a v1 long-header Initial packet: the header form, version, and connection IDs are the version-independent invariants that are always on the wire (RFC 8999); everything the Length field covers — the packet number and payload — is header-protected and AEAD-encrypted, so it stays opaque. QUIC uses variable-length integers for the connection-ID lengths, Token Length, and Length; they are shown here as fixed-width fields with representative values.',
  fields: [
    { id: 'headerForm', name: 'Header Form', type: 'uint', bitLength: 1, default: 1, description: '1 = long header.' },
    { id: 'fixedBit', name: 'Fixed Bit', type: 'uint', bitLength: 1, default: 1, description: 'Always 1 in QUIC v1.' },
    { id: 'longPacketType', name: 'Long Packet Type', type: 'uint', bitLength: 2, default: 0, enumRef: 'quic-long-type', description: 'Initial, 0-RTT, Handshake, or Retry.' },
    { id: 'typeSpecificBits', name: 'Type-Specific Bits', type: 'uint', bitLength: 4, default: 0, description: 'Reserved bits and packet-number length; header-protected on the wire.' },
    { id: 'version', name: 'Version', type: 'uint', bitLength: 32, default: 0x00000001, description: '0x00000001 = QUIC v1; 0 = Version Negotiation.' },
    { id: 'dcidLen', name: 'DCID Length', type: 'uint', bitLength: 8, default: 8, description: 'Destination Connection ID length in bytes.' },
    { id: 'dcid', name: 'Destination Connection ID', type: 'bytes', bitLength: 64, default: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]) },
    { id: 'scidLen', name: 'SCID Length', type: 'uint', bitLength: 8, default: 8, description: 'Source Connection ID length in bytes.' },
    { id: 'scid', name: 'Source Connection ID', type: 'bytes', bitLength: 64, default: new Uint8Array([8, 9, 10, 11, 12, 13, 14, 15]) },
    { id: 'tokenLength', name: 'Token Length', type: 'uint', bitLength: 8, default: 0, description: 'Variable-length integer; 0 = no token in this Initial.' },
    { id: 'length', name: 'Length', type: 'uint', bitLength: 16, default: 0x4020, description: 'Variable-length integer (2-byte form) covering the protected packet number and payload.' },
    { id: 'protectedPayload', name: 'Protected Payload', type: 'bytes', bitLength: 256, default: new Uint8Array(32), description: 'Packet number and AEAD-sealed frames; opaque without the keys.' },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.udpDstPort, value: 443 }],
};
