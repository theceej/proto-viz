import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { E } from '../core/expr';

export const tls: ProtocolDefinition = {
  id: 'tls',
  name: 'TLS Record',
  fullName: 'Transport Layer Security record layer',
  layerHint: 'application',
  source: 'builtin',
  description:
    'The 5-byte TLS record framing. Whatever follows (a handshake message, or an application-data payload such as HTTP) forms the record fragment; its length is computed automatically. Real application data would be encrypted — here it is shown in the clear for study.',
  fields: [
    { id: 'contentType', name: 'Content Type', type: 'uint', bitLength: 8, default: 23, enumRef: 'tls-content', description: '22 = handshake, 23 = application data.' },
    { id: 'legacyVersion', name: 'Legacy Version', type: 'uint', bitLength: 16, default: 0x0303, enumRef: 'tls-version', description: '0x0303 on the wire even for TLS 1.3.' },
    {
      id: 'length',
      name: 'Length',
      type: 'uint',
      bitLength: 16,
      computed: { kind: 'expr', expr: E.payloadBytes() },
      description: 'Fragment length in bytes.',
    },
  ],
  providesNamespaces: [
    { id: NS.tlsPayload, displayName: 'record fragment', selectorFieldId: null },
  ],
  encapsulations: [{ namespaceId: NS.tcpDstPort, value: 443 }],
};
