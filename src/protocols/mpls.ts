import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

export const mpls: ProtocolDefinition = {
  id: 'mpls',
  name: 'MPLS',
  fullName: 'Multiprotocol Label Switching label',
  layerHint: 'tunnel',
  source: 'builtin',
  description:
    'A 4-byte label-switching shim. Stack several MPLS layers for a label stack — clear the S bit on all but the innermost label. The payload type is not encoded; routers know it from the label.',
  fields: [
    { id: 'label', name: 'Label', type: 'uint', bitLength: 20, default: 100 },
    { id: 'tc', name: 'Traffic Class', type: 'uint', bitLength: 3, default: 0 },
    { id: 's', name: 'S', type: 'uint', bitLength: 1, default: 1, description: 'Bottom of label stack.' },
    { id: 'ttl', name: 'TTL', type: 'uint', bitLength: 8, default: 64 },
  ],
  providesNamespaces: [
    { id: NS.mplsPayload, displayName: 'label-switched payload', selectorFieldId: null },
  ],
  encapsulations: [
    { namespaceId: NS.ethertype, value: 0x8847 },
    { namespaceId: NS.mplsPayload }, // label stacking
  ],
};
