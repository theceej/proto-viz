import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

export const smb2: ProtocolDefinition = {
  id: 'smb2',
  name: 'SMB2',
  fullName: 'Server Message Block 2 header',
  layerHint: 'application',
  source: 'builtin',
  references: ['MS-SMB2'],
  description:
    'Windows file sharing on TCP 445 (behind a 4-byte NetBIOS length on the wire). This is the fixed 64-byte sync header; the command body follows as payload.',
  fields: [
    { id: 'protocolId', name: 'Protocol ID', type: 'bytes', bitLength: 32, default: new Uint8Array([0xfe, 0x53, 0x4d, 0x42]), description: '0xFE "SMB".' },
    { id: 'structureSize', name: 'Structure Size', type: 'uint', bitLength: 16, default: 64 },
    { id: 'creditCharge', name: 'Credit Charge', type: 'uint', bitLength: 16, default: 1 },
    { id: 'status', name: 'Status', type: 'uint', bitLength: 32, default: 0, description: 'NT status in responses; channel sequence in requests.' },
    { id: 'command', name: 'Command', type: 'uint', bitLength: 16, default: 0, enumRef: 'smb2-command' },
    { id: 'credits', name: 'Credits', type: 'uint', bitLength: 16, default: 1 },
    { id: 'smbFlags', name: 'Flags', type: 'uint', bitLength: 32, default: 0, description: '0x1 = response, 0x2 = async.' },
    { id: 'nextCommand', name: 'Next Command', type: 'uint', bitLength: 32, default: 0, description: 'Offset to the next chained command, or 0.' },
    { id: 'messageId', name: 'Message ID', type: 'uint', bitLength: 64, default: 1 },
    { id: 'reserved', name: 'Reserved', type: 'uint', bitLength: 32, default: 0 },
    { id: 'treeId', name: 'Tree ID', type: 'uint', bitLength: 32, default: 1 },
    { id: 'sessionId', name: 'Session ID', type: 'uint', bitLength: 64, default: 0x100000000001 },
    { id: 'signature', name: 'Signature', type: 'bytes', bitLength: 128, default: new Uint8Array(16) },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.tcpDstPort, value: 445 }],
};
