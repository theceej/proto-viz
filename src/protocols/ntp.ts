import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

export const ntp: ProtocolDefinition = {
  id: 'ntp',
  name: 'NTP',
  fullName: 'Network Time Protocol v4',
  layerHint: 'application',
  source: 'builtin',
  description:
    'Clock synchronisation over UDP 123. Defaults model a client request. Timestamps are 64-bit NTP format (seconds since 1900 · 2³²).',
  fields: [
    { id: 'li', name: 'LI', type: 'uint', bitLength: 2, default: 0, description: 'Leap indicator.' },
    { id: 'vn', name: 'Version', type: 'uint', bitLength: 3, default: 4 },
    { id: 'mode', name: 'Mode', type: 'uint', bitLength: 3, default: 3, enumRef: 'ntp-mode', description: '3 = client.' },
    { id: 'stratum', name: 'Stratum', type: 'uint', bitLength: 8, default: 0, description: '0 = unspecified (client).' },
    { id: 'poll', name: 'Poll', type: 'uint', bitLength: 8, default: 6, description: 'log2 seconds between messages.' },
    { id: 'precision', name: 'Precision', type: 'uint', bitLength: 8, default: 0x20, description: 'log2 seconds (two’s complement).' },
    { id: 'rootDelay', name: 'Root Delay', type: 'uint', bitLength: 32, default: 0 },
    { id: 'rootDispersion', name: 'Root Dispersion', type: 'uint', bitLength: 32, default: 0 },
    { id: 'referenceId', name: 'Reference ID', type: 'uint', bitLength: 32, default: 0 },
    { id: 'refTimestamp', name: 'Reference Timestamp', type: 'uint', bitLength: 64, default: 0 },
    { id: 'origTimestamp', name: 'Origin Timestamp', type: 'uint', bitLength: 64, default: 0 },
    { id: 'rxTimestamp', name: 'Receive Timestamp', type: 'uint', bitLength: 64, default: 0 },
    { id: 'txTimestamp', name: 'Transmit Timestamp', type: 'uint', bitLength: 64, default: 0xec4bd51c00000000n, description: 'Time this packet left the sender.' },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.udpDstPort, value: 123 }],
};
