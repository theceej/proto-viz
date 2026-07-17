import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

/** Modeled as a read request; DATA/ACK packets have a different shape. */
export const tftp: ProtocolDefinition = {
  id: 'tftp',
  name: 'TFTP',
  fullName: 'Trivial File Transfer Protocol (read request)',
  layerHint: 'application',
  source: 'builtin',
  references: ['RFC 1350'],
  description:
    'Minimal file transfer over UDP 69. Modeled as an RRQ/WRQ packet: opcode, then a zero-terminated filename and transfer mode.',
  fields: [
    { id: 'opcode', name: 'Opcode', type: 'uint', bitLength: 16, default: 1, enumRef: 'tftp-opcode' },
    { id: 'filename', name: 'Filename', type: 'string', bitLength: 'auto', default: 'firmware.bin' },
    { id: 'filenameEnd', name: 'Filename Terminator', type: 'uint', bitLength: 8, default: 0 },
    { id: 'mode', name: 'Mode', type: 'string', bitLength: 'auto', default: 'octet', description: '"octet" (binary) or "netascii".' },
    { id: 'modeEnd', name: 'Mode Terminator', type: 'uint', bitLength: 8, default: 0 },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.udpDstPort, value: 69 }],
};
