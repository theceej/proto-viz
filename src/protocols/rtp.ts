import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

export const rtp: ProtocolDefinition = {
  id: 'rtp',
  name: 'RTP',
  fullName: 'Real-time Transport Protocol',
  layerHint: 'application',
  source: 'builtin',
  references: ['RFC 3550'],
  description:
    'Carries live audio/video samples. Sequence numbers order packets; the timestamp advances in media clock units (e.g. 160 per 20 ms of 8 kHz audio).',
  fields: [
    { id: 'version', name: 'V', type: 'uint', bitLength: 2, default: 2 },
    { id: 'padding', name: 'P', type: 'uint', bitLength: 1, default: 0 },
    { id: 'extension', name: 'X', type: 'uint', bitLength: 1, default: 0 },
    { id: 'csrcCount', name: 'CC', type: 'uint', bitLength: 4, default: 0, description: 'Contributing source count.' },
    { id: 'marker', name: 'M', type: 'uint', bitLength: 1, default: 0, description: 'Talkspurt start / frame boundary.' },
    { id: 'payloadType', name: 'PT', type: 'uint', bitLength: 7, default: 0, enumRef: 'rtp-pt' },
    { id: 'sequenceNumber', name: 'Sequence Number', type: 'uint', bitLength: 16, default: 1000 },
    { id: 'timestamp', name: 'Timestamp', type: 'uint', bitLength: 32, default: 160 },
    { id: 'ssrc', name: 'SSRC', type: 'uint', bitLength: 32, default: 0x12345678, description: 'Synchronization source identifier.' },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.udpDstPort, value: 5004 }],
};
