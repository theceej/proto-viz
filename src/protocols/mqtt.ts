import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { E } from '../core/expr';

export const mqtt: ProtocolDefinition = {
  id: 'mqtt',
  name: 'MQTT',
  fullName: 'Message Queuing Telemetry Transport',
  layerHint: 'application',
  source: 'builtin',
  description:
    'Publish/subscribe messaging for IoT on TCP 1883. The variable header and payload ride as packet payload; Remaining Length is modeled as one byte, so packets up to 127 bytes.',
  fields: [
    { id: 'packetType', name: 'Packet Type', type: 'uint', bitLength: 4, default: 1, enumRef: 'mqtt-type' },
    { id: 'typeFlags', name: 'Flags', type: 'uint', bitLength: 4, default: 0, description: 'DUP/QoS/RETAIN for PUBLISH; 0 otherwise.' },
    {
      id: 'remainingLength', name: 'Remaining Length', type: 'uint', bitLength: 8,
      computed: { kind: 'expr', expr: E.payloadBytes() },
      description: 'Variable-length encoding on the wire; single byte (<128) modeled here.',
    },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.tcpDstPort, value: 1883 }],
};
