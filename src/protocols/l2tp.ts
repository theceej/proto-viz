import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { E } from '../core/expr';

export const l2tp: ProtocolDefinition = {
  id: 'l2tp',
  name: 'L2TP',
  fullName: 'Layer 2 Tunneling Protocol v2',
  layerHint: 'tunnel',
  source: 'builtin',
  description:
    'Tunnels PPP frames over UDP 1701. Defaults model a data message with the optional Length field present; sequence and offset fields appear when their flag bits are set.',
  fields: [
    { id: 't', name: 'T', type: 'uint', bitLength: 1, default: 0, description: '0 = data message, 1 = control.' },
    { id: 'l', name: 'L', type: 'uint', bitLength: 1, default: 1, description: 'Length field present.' },
    { id: 'res1', name: 'Reserved', type: 'uint', bitLength: 2, default: 0 },
    { id: 's', name: 'S', type: 'uint', bitLength: 1, default: 0, description: 'Ns/Nr fields present.' },
    { id: 'res2', name: 'Reserved', type: 'uint', bitLength: 1, default: 0 },
    { id: 'o', name: 'O', type: 'uint', bitLength: 1, default: 0, description: 'Offset field present.' },
    { id: 'p', name: 'P', type: 'uint', bitLength: 1, default: 0, description: 'Priority.' },
    { id: 'res3', name: 'Reserved', type: 'uint', bitLength: 4, default: 0 },
    { id: 'version', name: 'Version', type: 'uint', bitLength: 4, default: 2 },
    {
      id: 'length',
      name: 'Length',
      type: 'uint',
      bitLength: 16,
      presentIf: E.field('l'),
      computed: { kind: 'expr', expr: E.add(E.headerBytes(), E.payloadBytes()) },
      description: 'Total message length (present when L set).',
    },
    { id: 'tunnelId', name: 'Tunnel ID', type: 'uint', bitLength: 16, default: 1 },
    { id: 'sessionId', name: 'Session ID', type: 'uint', bitLength: 16, default: 1 },
    { id: 'ns', name: 'Ns', type: 'uint', bitLength: 16, default: 0, presentIf: E.field('s'), description: 'Send sequence (present when S set).' },
    { id: 'nr', name: 'Nr', type: 'uint', bitLength: 16, default: 0, presentIf: E.field('s'), description: 'Expected receive sequence (present when S set).' },
    { id: 'offsetSize', name: 'Offset Size', type: 'uint', bitLength: 16, default: 0, presentIf: E.field('o') },
  ],
  providesNamespaces: [
    { id: NS.l2tpPayload, displayName: 'tunneled PPP frame', selectorFieldId: null },
  ],
  encapsulations: [{ namespaceId: NS.udpDstPort, value: 1701 }],
};
