import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { E } from '../core/expr';

export const modbus: ProtocolDefinition = {
  id: 'modbus',
  name: 'Modbus TCP',
  fullName: 'Modbus application protocol over TCP',
  layerHint: 'application',
  source: 'builtin',
  references: ['Modbus Application Protocol V1.1b3'],
  description:
    'The industrial-control staple on TCP 502: an MBAP header plus a function code. Request/response data (register addresses and values) rides as payload.',
  fields: [
    { id: 'transactionId', name: 'Transaction ID', type: 'uint', bitLength: 16, default: 1 },
    { id: 'protocolId', name: 'Protocol ID', type: 'uint', bitLength: 16, default: 0, description: 'Always 0 for Modbus.' },
    {
      id: 'length', name: 'Length', type: 'uint', bitLength: 16,
      computed: { kind: 'expr', expr: E.add(E.const(2), E.payloadBytes()) },
      description: 'Bytes following: unit ID, function code, and data.',
    },
    { id: 'unitId', name: 'Unit ID', type: 'uint', bitLength: 8, default: 1, description: 'Target device / slave address.' },
    { id: 'functionCode', name: 'Function Code', type: 'uint', bitLength: 8, default: 3, enumRef: 'modbus-function' },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.tcpDstPort, value: 502 }],
};
