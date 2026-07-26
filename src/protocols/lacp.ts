import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

const stateFlags = [
  { bit: 0, name: 'LACP_Activity', description: '1 = Active, 0 = Passive' },
  { bit: 1, name: 'LACP_Timeout', description: '1 = Short, 0 = Long' },
  { bit: 2, name: 'Aggregation', description: '1 = Aggregatable, 0 = Individual' },
  { bit: 3, name: 'Synchronization', description: '1 = In Sync, 0 = Out of Sync' },
  { bit: 4, name: 'Collecting', description: '1 = Yes, 0 = No' },
  { bit: 5, name: 'Distributing', description: '1 = Yes, 0 = No' },
  { bit: 6, name: 'Defaulted', description: '1 = Defaulted, 0 = Not Defaulted' },
  { bit: 7, name: 'Expired', description: '1 = Expired, 0 = Not Expired' },
];

export const lacp: ProtocolDefinition = {
  id: 'lacp',
  name: 'LACP',
  fullName: 'Link Aggregation Control Protocol (IEEE 802.1AX)',
  layerHint: 'link',
  source: 'builtin',
  description:
    'Exchanges port state information to dynamically build link aggregation groups (LAGs). Sent over Slow Protocols.',
  fields: [
    { id: 'subtype', name: 'Slow Protocols Subtype', type: 'uint', bitLength: 8, default: 1, description: '1 for LACP.' },
    { id: 'version', name: 'LACP Version', type: 'uint', bitLength: 8, default: 1 },

    // Actor Information
    { id: 'actorTlvType', name: 'Actor TLV Type', type: 'uint', bitLength: 8, default: 1 },
    { id: 'actorTlvLen', name: 'Actor TLV Length', type: 'uint', bitLength: 8, default: 20 },
    { id: 'actorSysPri', name: 'Actor System Priority', type: 'uint', bitLength: 16, default: 32768 },
    { id: 'actorSysMac', name: 'Actor System', type: 'bytes', bitLength: 48, default: new Uint8Array(6) },
    { id: 'actorKey', name: 'Actor Key', type: 'uint', bitLength: 16, default: 1 },
    { id: 'actorPortPri', name: 'Actor Port Priority', type: 'uint', bitLength: 16, default: 32768 },
    { id: 'actorPort', name: 'Actor Port', type: 'uint', bitLength: 16, default: 1 },
    { id: 'actorState', name: 'Actor State', type: 'flags', bitLength: 8, default: 0, flags: stateFlags },
    { id: 'actorReserved', name: 'Actor Reserved', type: 'bytes', bitLength: 24, default: new Uint8Array(3) },

    // Partner Information
    { id: 'partnerTlvType', name: 'Partner TLV Type', type: 'uint', bitLength: 8, default: 2 },
    { id: 'partnerTlvLen', name: 'Partner TLV Length', type: 'uint', bitLength: 8, default: 20 },
    { id: 'partnerSysPri', name: 'Partner System Priority', type: 'uint', bitLength: 16, default: 0 },
    { id: 'partnerSysMac', name: 'Partner System', type: 'bytes', bitLength: 48, default: new Uint8Array(6) },
    { id: 'partnerKey', name: 'Partner Key', type: 'uint', bitLength: 16, default: 0 },
    { id: 'partnerPortPri', name: 'Partner Port Priority', type: 'uint', bitLength: 16, default: 0 },
    { id: 'partnerPort', name: 'Partner Port', type: 'uint', bitLength: 16, default: 0 },
    { id: 'partnerState', name: 'Partner State', type: 'flags', bitLength: 8, default: 0, flags: stateFlags },
    { id: 'partnerReserved', name: 'Partner Reserved', type: 'bytes', bitLength: 24, default: new Uint8Array(3) },

    // Collector Information
    { id: 'collectorTlvType', name: 'Collector TLV Type', type: 'uint', bitLength: 8, default: 3 },
    { id: 'collectorTlvLen', name: 'Collector TLV Length', type: 'uint', bitLength: 8, default: 16 },
    { id: 'collectorMaxDelay', name: 'Collector Max Delay', type: 'uint', bitLength: 16, default: 0 },
    { id: 'collectorReserved', name: 'Collector Reserved', type: 'bytes', bitLength: 96, default: new Uint8Array(12) },

    // Terminator
    { id: 'terminatorTlvType', name: 'Terminator TLV Type', type: 'uint', bitLength: 8, default: 0 },
    { id: 'terminatorTlvLen', name: 'Terminator TLV Length', type: 'uint', bitLength: 8, default: 0 },
    { id: 'terminatorReserved', name: 'Terminator Reserved', type: 'bytes', bitLength: 400, default: new Uint8Array(50) },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.ethertype, value: 0x8809 }],
};
