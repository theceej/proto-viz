import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { E } from '../core/expr';

export const ospf: ProtocolDefinition = {
  id: 'ospf',
  name: 'OSPF',
  fullName: 'Open Shortest Path First v2 header',
  layerHint: 'network',
  source: 'builtin',
  description:
    'Link-state routing directly over IP (protocol 89). The 24-byte common header is modeled; packet-type-specific bodies go in the payload. The standard checksum excludes the authentication field — which matches this computation as long as authentication is null (zeros).',
  fields: [
    { id: 'version', name: 'Version', type: 'uint', bitLength: 8, default: 2 },
    { id: 'type', name: 'Type', type: 'uint', bitLength: 8, default: 1, enumRef: 'ospf-type', description: '1 = Hello.' },
    {
      id: 'packetLength',
      name: 'Packet Length',
      type: 'uint',
      bitLength: 16,
      computed: { kind: 'expr', expr: E.add(E.headerBytes(), E.payloadBytes()) },
      description: 'Header plus body, in bytes.',
    },
    { id: 'routerId', name: 'Router ID', type: 'ipv4', bitLength: 32, default: '1.1.1.1' },
    { id: 'areaId', name: 'Area ID', type: 'ipv4', bitLength: 32, default: '0.0.0.0', description: '0.0.0.0 = backbone.' },
    {
      id: 'checksum',
      name: 'Checksum',
      type: 'uint',
      bitLength: 16,
      computed: { kind: 'checksum', algorithm: 'inet16', scope: 'headerAndPayload' },
      description: 'Valid while AuType is null authentication.',
    },
    { id: 'auType', name: 'AuType', type: 'uint', bitLength: 16, default: 0, description: '0 = null authentication.' },
    { id: 'authentication', name: 'Authentication', type: 'uint', bitLength: 64, default: 0 },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.ipProto, value: 89 }],
};
