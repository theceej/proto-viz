import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { E } from '../core/expr';

export const bfd: ProtocolDefinition = {
  id: 'bfd',
  name: 'BFD',
  fullName: 'Bidirectional Forwarding Detection',
  layerHint: 'network',
  source: 'builtin',
  description:
    'Millisecond-scale liveness detection between forwarding engines, typically over UDP 3784. Timer values are microseconds.',
  fields: [
    { id: 'version', name: 'Vers', type: 'uint', bitLength: 3, default: 1 },
    { id: 'diag', name: 'Diag', type: 'uint', bitLength: 5, default: 0, description: 'Reason for last state change.' },
    { id: 'state', name: 'Sta', type: 'uint', bitLength: 2, default: 3, enumRef: 'bfd-state' },
    {
      id: 'bfdFlags', name: 'Flags', type: 'flags', bitLength: 6, default: 0,
      flags: [
        { bit: 0, name: 'P', description: 'Poll' },
        { bit: 1, name: 'F', description: 'Final' },
        { bit: 2, name: 'C', description: 'Control Plane Independent' },
        { bit: 3, name: 'A', description: 'Authentication Present' },
        { bit: 4, name: 'D', description: 'Demand' },
        { bit: 5, name: 'M', description: 'Multipoint' },
      ],
    },
    { id: 'detectMult', name: 'Detect Mult', type: 'uint', bitLength: 8, default: 3, description: 'Missed-packet multiplier before declaring down.' },
    {
      id: 'length', name: 'Length', type: 'uint', bitLength: 8,
      computed: { kind: 'expr', expr: E.headerBytes() },
      description: 'Length of this control packet.',
    },
    { id: 'myDiscriminator', name: 'My Discriminator', type: 'uint', bitLength: 32, default: 1 },
    { id: 'yourDiscriminator', name: 'Your Discriminator', type: 'uint', bitLength: 32, default: 0, description: '0 until the far end is learned.' },
    { id: 'desiredMinTx', name: 'Desired Min TX Interval', type: 'uint', bitLength: 32, default: 1000000 },
    { id: 'requiredMinRx', name: 'Required Min RX Interval', type: 'uint', bitLength: 32, default: 1000000 },
    { id: 'requiredMinEchoRx', name: 'Required Min Echo RX', type: 'uint', bitLength: 32, default: 0 },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.udpDstPort, value: 3784 }],
};
