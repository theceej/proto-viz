import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

export const wireguard: ProtocolDefinition = {
  id: 'wireguard',
  name: 'WireGuard',
  fullName: 'WireGuard handshake initiation',
  layerHint: 'tunnel',
  source: 'builtin',
  references: ['WireGuard whitepaper (Donenfeld)'],
  description:
    'Modern VPN handshake (UDP 51820, Noise IK). The ephemeral key is the only plaintext key material; the static key and timestamp are already encrypted. Transport data packets that follow are fully opaque.',
  fields: [
    { id: 'type', name: 'Type', type: 'uint', bitLength: 8, default: 1, enumRef: 'wireguard-type' },
    { id: 'reserved', name: 'Reserved', type: 'uint', bitLength: 24, default: 0 },
    { id: 'senderIndex', name: 'Sender Index', type: 'uint', bitLength: 32, default: 0x01000000 },
    { id: 'unencryptedEphemeral', name: 'Unencrypted Ephemeral', type: 'bytes', bitLength: 256, default: new Uint8Array(32), description: 'Curve25519 public key.' },
    { id: 'encryptedStatic', name: 'Encrypted Static', type: 'bytes', bitLength: 384, default: new Uint8Array(48), description: "Initiator's static key, AEAD-sealed." },
    { id: 'encryptedTimestamp', name: 'Encrypted Timestamp', type: 'bytes', bitLength: 224, default: new Uint8Array(28), description: 'TAI64N timestamp, AEAD-sealed.' },
    { id: 'mac1', name: 'MAC1', type: 'bytes', bitLength: 128, default: new Uint8Array(16) },
    { id: 'mac2', name: 'MAC2', type: 'bytes', bitLength: 128, default: new Uint8Array(16), description: 'Zero unless under load (cookie reply).' },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.udpDstPort, value: 51820 }],
};
