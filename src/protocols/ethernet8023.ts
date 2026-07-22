import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { E } from '../core/expr';

/** 802.3 frame with the 802.2 LLC header folded in (how STP travels). */
export const ethernet8023: ProtocolDefinition = {
  id: 'ethernet-8023',
  name: 'Ethernet 802.3 (LLC)',
  fullName: 'IEEE 802.3 frame with 802.2 LLC header',
  layerHint: 'link',
  source: 'builtin',
  description:
    'Classic IEEE framing: the field after the MACs is a length, not an EtherType, and an LLC header selects the payload by SAP. Spanning Tree BPDUs are the best-known traffic carried this way.',
  fields: [
    { id: 'dstMac', name: 'Destination MAC', type: 'mac', bitLength: 48, default: '01:80:c2:00:00:00', description: 'Bridge group multicast address by default (used by STP).' },
    { id: 'srcMac', name: 'Source MAC', type: 'mac', bitLength: 48, default: '02:00:00:00:00:01' },
    {
      id: 'length', name: 'Length', type: 'uint', bitLength: 16,
      computed: { kind: 'expr', expr: E.add(E.const(3), E.payloadBytes()) },
      description: 'Bytes following this field: the 3-byte LLC header plus payload.',
    },
    { id: 'dsap', name: 'DSAP', type: 'uint', bitLength: 8, default: 0x42, computed: { kind: 'binding' }, description: 'Destination Service Access Point (auto-set; 0x42 = spanning tree).' },
    { id: 'ssap', name: 'SSAP', type: 'uint', bitLength: 8, default: 0x42, description: 'Source Service Access Point.' },
    { id: 'control', name: 'Control', type: 'uint', bitLength: 8, default: 0x03, description: '0x03 = unnumbered information.' },
  ],
  providesNamespaces: [
    { id: NS.llcSap, displayName: 'LLC SAP', selectorFieldId: 'dsap' },
  ],
  encapsulations: [],
};
