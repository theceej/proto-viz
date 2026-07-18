import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { E } from '../core/expr';

export const smb2: ProtocolDefinition = {
  id: 'smb2',
  name: 'SMB2',
  fullName: 'Server Message Block 2 header',
  layerHint: 'application',
  source: 'builtin',
  references: ['MS-SMB2'],
  description:
    'Windows file sharing on TCP 445. The 4-byte NetBIOS session header and fixed 64-byte SMB2 sync header are modeled; the command body follows as payload.',
  fields: [
    { id: 'sessionType', name: 'NetBIOS Session Type', type: 'uint', bitLength: 8, default: 0, description: '0 = session message.' },
    {
      id: 'sessionLength', name: 'NetBIOS Session Length', type: 'uint', bitLength: 24,
      computed: { kind: 'expr', expr: E.sub(E.add(E.headerBytes(), E.payloadBytes()), E.const(4)) },
      description: 'Length of the SMB2 message following the 4-byte session header.',
    },
    { id: 'protocolId', name: 'Protocol ID', type: 'bytes', bitLength: 32, default: new Uint8Array([0xfe, 0x53, 0x4d, 0x42]), description: '0xFE "SMB".' },
    { id: 'structureSize', name: 'Structure Size (LE)', type: 'bytes', bitLength: 16, default: new Uint8Array([64, 0]) },
    { id: 'creditCharge', name: 'Credit Charge (LE)', type: 'bytes', bitLength: 16, default: new Uint8Array([1, 0]) },
    { id: 'status', name: 'Status (LE)', type: 'bytes', bitLength: 32, default: new Uint8Array(4), description: 'NT status in responses; channel sequence in requests.' },
    { id: 'command', name: 'Command (LE)', type: 'bytes', bitLength: 16, default: new Uint8Array([0, 0]) },
    { id: 'credits', name: 'Credits (LE)', type: 'bytes', bitLength: 16, default: new Uint8Array([1, 0]) },
    { id: 'smbFlags', name: 'Flags (LE)', type: 'bytes', bitLength: 32, default: new Uint8Array(4), description: '0x1 = response, 0x2 = async.' },
    { id: 'nextCommand', name: 'Next Command (LE)', type: 'bytes', bitLength: 32, default: new Uint8Array(4), description: 'Offset to the next chained command, or 0.' },
    { id: 'messageId', name: 'Message ID (LE)', type: 'bytes', bitLength: 64, default: new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]) },
    { id: 'reserved', name: 'Reserved', type: 'bytes', bitLength: 32, default: new Uint8Array(4) },
    { id: 'treeId', name: 'Tree ID (LE)', type: 'bytes', bitLength: 32, default: new Uint8Array([1, 0, 0, 0]) },
    { id: 'sessionId', name: 'Session ID (LE)', type: 'bytes', bitLength: 64, default: new Uint8Array(8) },
    { id: 'signature', name: 'Signature', type: 'bytes', bitLength: 128, default: new Uint8Array(16) },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.tcpDstPort, value: 445 }],
};
