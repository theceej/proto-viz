import { NS } from '../core/bindings';
import { E } from '../core/expr';
import type { FieldDef, ProtocolDefinition, SemanticLintRule } from '../core/model';

const initiatorSpi = new Uint8Array([0x49, 0x4b, 0x45, 0x76, 0x32, 0x00, 0x00, 0x01]);

function ikeFields(natTraversal: boolean): FieldDef[] {
  return [
    ...(natTraversal
      ? [{
          id: 'nonEspMarker',
          name: 'Non-ESP Marker',
          type: 'uint' as const,
          bitLength: 32,
          default: 0,
          description: 'Four zero octets distinguish IKE from ESP-in-UDP on port 4500.',
        }]
      : []),
    {
      id: 'initiatorSpi',
      name: 'Initiator SPI',
      type: 'bytes',
      bitLength: 64,
      default: initiatorSpi,
      description: 'Chosen by the initiator; nonzero for IKE_SA_INIT.',
    },
    {
      id: 'responderSpi',
      name: 'Responder SPI',
      type: 'bytes',
      bitLength: 64,
      default: new Uint8Array(8),
      description: 'Zero in the initial request, then chosen by the responder.',
    },
    {
      id: 'nextPayload',
      name: 'Next Payload',
      type: 'uint',
      bitLength: 8,
      default: 0,
      enumRef: 'ikev2-payload-type',
      description: 'Type of the first payload after the IKE header; 0 means none.',
    },
    {
      id: 'majorVersion',
      name: 'Major Version',
      type: 'uint',
      bitLength: 4,
      default: 2,
      description: 'Major IKE version; RFC 7296 uses 2.',
    },
    {
      id: 'minorVersion',
      name: 'Minor Version',
      type: 'uint',
      bitLength: 4,
      default: 0,
      description: 'Minor IKE version; RFC 7296 uses 0.',
    },
    {
      id: 'exchangeType',
      name: 'Exchange Type',
      type: 'uint',
      bitLength: 8,
      default: 34,
      enumRef: 'ikev2-exchange-type',
    },
    {
      id: 'flags',
      name: 'Flags',
      type: 'flags',
      bitLength: 8,
      default: 0x08,
      flags: [
        { bit: 2, name: 'Response (R)', description: 'Set on response messages.' },
        { bit: 3, name: 'Higher Version (V)', description: 'Sender can use a higher major version.' },
        { bit: 4, name: 'Initiator (I)', description: 'Set by the original IKE SA initiator.' },
      ],
    },
    {
      id: 'messageId',
      name: 'Message ID',
      type: 'uint',
      bitLength: 32,
      default: 0,
      description: 'Request/response sequence number within the IKE SA.',
    },
    {
      id: 'length',
      name: 'Length',
      type: 'uint',
      bitLength: 32,
      computed: {
        kind: 'expr',
        expr: natTraversal
          ? E.sub(E.add(E.headerBytes(), E.payloadBytes()), E.const(4))
          : E.add(E.headerBytes(), E.payloadBytes()),
      },
      description: 'Total IKE message length, including the IKE header and all payloads.',
    },
  ];
}

const versionRules: SemanticLintRule[] = [
  {
    kind: 'value',
    fieldId: 'majorVersion',
    operator: 'notEquals',
    value: 2,
    severity: 'warning',
    code: 'ikev2-major-version',
    message: 'IKEv2 Major Version should be 2.',
    reference: 'RFC 7296 section 3.1',
  },
  {
    kind: 'value',
    fieldId: 'minorVersion',
    operator: 'notEquals',
    value: 0,
    severity: 'warning',
    code: 'ikev2-minor-version',
    message: 'IKEv2 Minor Version should be 0.',
    reference: 'RFC 7296 section 3.1',
  },
];

export const ikev2: ProtocolDefinition = {
  id: 'ikev2',
  name: 'IKEv2',
  fullName: 'Internet Key Exchange Protocol Version 2',
  layerHint: 'tunnel',
  source: 'builtin',
  description:
    'Negotiates and maintains IPsec security associations over UDP 500. Payloads after the fixed header may be encrypted and are kept as opaque packet payload bytes.',
  fields: ikeFields(false),
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.udpDstPort, value: 500 }],
  lintRules: versionRules,
  references: ['RFC 7296'],
};

export const ikev2Natt: ProtocolDefinition = {
  ...ikev2,
  id: 'ikev2-natt',
  name: 'IKEv2 NAT-T',
  fullName: 'IKEv2 with UDP Encapsulation',
  description:
    'IKEv2 on UDP 4500 with the four-byte Non-ESP marker required to distinguish IKE messages from ESP-in-UDP traffic.',
  fields: ikeFields(true),
  encapsulations: [{ namespaceId: NS.udpDstPort, value: 4500 }],
  lintRules: [
    ...versionRules,
    {
      kind: 'value',
      fieldId: 'nonEspMarker',
      operator: 'notEquals',
      value: 0,
      severity: 'warning',
      code: 'ikev2-natt-marker',
      message: 'The UDP-encapsulated IKE Non-ESP Marker must be zero.',
      reference: 'RFC 3948 section 2.2',
    },
  ],
  references: ['RFC 7296', 'RFC 3948'],
};
