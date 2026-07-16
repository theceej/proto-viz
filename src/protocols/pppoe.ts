import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { E } from '../core/expr';

export const pppoe: ProtocolDefinition = {
  id: 'pppoe',
  name: 'PPPoE',
  fullName: 'PPP over Ethernet (session stage)',
  layerHint: 'link',
  source: 'builtin',
  references: ['RFC 2516'],
  description:
    'Carries PPP sessions over Ethernet (EtherType 0x8864). The PPP protocol field is included here, so IPv4/IPv6 bind onto it directly. Length is computed automatically.',
  fields: [
    { id: 'version', name: 'Version', type: 'uint', bitLength: 4, default: 1 },
    { id: 'type', name: 'Type', type: 'uint', bitLength: 4, default: 1 },
    { id: 'code', name: 'Code', type: 'uint', bitLength: 8, default: 0, enumRef: 'pppoe-code', description: '0 = session data.' },
    { id: 'sessionId', name: 'Session ID', type: 'uint', bitLength: 16, default: 1 },
    {
      id: 'length',
      name: 'Length',
      type: 'uint',
      bitLength: 16,
      computed: {
        kind: 'expr',
        // PPP protocol field (2 bytes) + payload; excludes the 6-byte PPPoE header
        expr: E.add(E.sub(E.headerBytes(), E.const(6)), E.payloadBytes()),
      },
      description: 'Payload length including the PPP protocol field.',
    },
    {
      id: 'pppProtocol',
      name: 'PPP Protocol',
      type: 'uint',
      bitLength: 16,
      default: 0x0021,
      enumRef: 'ppp-proto',
      computed: { kind: 'binding' },
      description: 'Protocol of the PPP payload (auto-set).',
    },
  ],
  providesNamespaces: [
    { id: NS.pppProto, displayName: 'PPP Protocol', selectorFieldId: 'pppProtocol' },
  ],
  encapsulations: [{ namespaceId: NS.ethertype, value: 0x8864 }],
};
