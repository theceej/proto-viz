import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

/** Header plus one route entry; real responses carry up to 25 entries. */
export const ripv2: ProtocolDefinition = {
  id: 'ripv2',
  name: 'RIPv2',
  fullName: 'Routing Information Protocol version 2',
  layerHint: 'network',
  source: 'builtin',
  references: ['RFC 2453'],
  description:
    'Distance-vector routing over UDP 520 to multicast 224.0.0.9. Modeled with a single 20-byte route entry; responses may carry up to 25.',
  fields: [
    { id: 'command', name: 'Command', type: 'uint', bitLength: 8, default: 2, description: '1 = Request, 2 = Response.' },
    { id: 'version', name: 'Version', type: 'uint', bitLength: 8, default: 2 },
    { id: 'mustBeZero', name: 'Must Be Zero', type: 'uint', bitLength: 16, default: 0 },
    { id: 'afi', name: 'Address Family', type: 'uint', bitLength: 16, default: 2, description: '2 = IP.' },
    { id: 'routeTag', name: 'Route Tag', type: 'uint', bitLength: 16, default: 0 },
    { id: 'ipAddress', name: 'IP Address', type: 'ipv4', bitLength: 32, default: '203.0.113.0' },
    { id: 'subnetMask', name: 'Subnet Mask', type: 'ipv4', bitLength: 32, default: '255.255.255.0' },
    { id: 'nextHop', name: 'Next Hop', type: 'ipv4', bitLength: 32, default: '0.0.0.0', description: '0.0.0.0 = via the sender.' },
    { id: 'metric', name: 'Metric', type: 'uint', bitLength: 32, default: 1, description: 'Hop count; 16 = unreachable.' },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.udpDstPort, value: 520 }],
};
