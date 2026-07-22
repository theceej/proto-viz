import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { E } from '../core/expr';

export const udp: ProtocolDefinition = {
  id: 'udp',
  name: 'UDP',
  fullName: 'User Datagram Protocol',
  layerHint: 'transport',
  source: 'builtin',
  description:
    'Connectionless transport. Length and Checksum are computed automatically (the checksum includes the IP pseudo-header). The destination port is auto-set when an application protocol follows.',
  fields: [
    {
      id: 'srcPort',
      name: 'Source Port',
      type: 'uint',
      bitLength: 16,
      default: 49152,
      enumRef: 'well-known-port',
      description: 'Sending port (ephemeral by default).',
    },
    {
      id: 'dstPort',
      name: 'Destination Port',
      type: 'uint',
      bitLength: 16,
      default: 9,
      enumRef: 'well-known-port',
      computed: { kind: 'binding' },
      description: 'Receiving port (auto-set from the next layer; default 9/discard).',
    },
    {
      id: 'length',
      name: 'Length',
      type: 'uint',
      bitLength: 16,
      computed: { kind: 'expr', expr: E.add(E.headerBytes(), E.payloadBytes()) },
      description: 'Length of UDP header plus payload.',
    },
    {
      id: 'checksum',
      name: 'Checksum',
      type: 'uint',
      bitLength: 16,
      computed: {
        kind: 'checksum',
        algorithm: 'inet16',
        scope: 'headerAndPayload',
        pseudoHeader: 'auto',
        zeroSubstitute: true,
      },
      description: 'Internet checksum over pseudo-header, header, and payload.',
    },
  ],
  providesNamespaces: [
    { id: NS.udpDstPort, displayName: 'UDP port', selectorFieldId: 'dstPort' },
  ],
  encapsulations: [{ namespaceId: NS.ipProto, value: 17 }],
};
