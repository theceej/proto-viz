import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { E } from '../core/expr';

export const rtcp: ProtocolDefinition = {
  id: 'rtcp',
  name: 'RTCP',
  fullName: 'RTP Control Protocol (Sender Report)',
  layerHint: 'application',
  source: 'builtin',
  references: ['RFC 3550'],
  description:
    'Quality feedback for an RTP session, modeled as a Sender Report with no reception blocks. Length is in 32-bit words minus one.',
  fields: [
    { id: 'version', name: 'V', type: 'uint', bitLength: 2, default: 2 },
    { id: 'padding', name: 'P', type: 'uint', bitLength: 1, default: 0 },
    { id: 'rc', name: 'RC', type: 'uint', bitLength: 5, default: 0, description: 'Reception report count.' },
    { id: 'packetType', name: 'Packet Type', type: 'uint', bitLength: 8, default: 200, enumRef: 'rtcp-pt' },
    {
      id: 'length', name: 'Length', type: 'uint', bitLength: 16,
      computed: { kind: 'expr', expr: E.sub(E.div(E.add(E.headerBytes(), E.payloadBytes()), E.const(4)), E.const(1)) },
      description: 'Packet length in 32-bit words, minus one.',
    },
    { id: 'ssrc', name: 'SSRC of Sender', type: 'uint', bitLength: 32, default: 0x12345678 },
    { id: 'ntpTsMsw', name: 'NTP Timestamp MSW', type: 'uint', bitLength: 32, default: 0xe8000000 },
    { id: 'ntpTsLsw', name: 'NTP Timestamp LSW', type: 'uint', bitLength: 32, default: 0 },
    { id: 'rtpTimestamp', name: 'RTP Timestamp', type: 'uint', bitLength: 32, default: 160 },
    { id: 'packetCount', name: "Sender's Packet Count", type: 'uint', bitLength: 32, default: 50 },
    { id: 'octetCount', name: "Sender's Octet Count", type: 'uint', bitLength: 32, default: 8000 },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.udpDstPort, value: 5005 }],
};
