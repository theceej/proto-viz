import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { dns } from './dns';

export const ripv1: ProtocolDefinition = {
  id: 'ripv1',
  name: 'RIPv1',
  fullName: 'Routing Information Protocol version 1',
  layerHint: 'network',
  source: 'builtin',
  description:
    'The 1988 original: classful (no subnet masks), broadcast rather than multicast. Modeled with one route entry.',
  fields: [
    { id: 'command', name: 'Command', type: 'uint', bitLength: 8, default: 2, description: '1 = Request, 2 = Response.' },
    { id: 'version', name: 'Version', type: 'uint', bitLength: 8, default: 1 },
    { id: 'mustBeZero', name: 'Must Be Zero', type: 'uint', bitLength: 16, default: 0 },
    { id: 'afi', name: 'Address Family', type: 'uint', bitLength: 16, default: 2, description: '2 = IP.' },
    { id: 'zero1', name: 'Must Be Zero', type: 'uint', bitLength: 16, default: 0 },
    { id: 'ipAddress', name: 'IP Address', type: 'ipv4', bitLength: 32, default: '203.0.113.0' },
    { id: 'zero2', name: 'Must Be Zero', type: 'uint', bitLength: 32, default: 0 },
    { id: 'zero3', name: 'Must Be Zero', type: 'uint', bitLength: 32, default: 0 },
    { id: 'metric', name: 'Metric', type: 'uint', bitLength: 32, default: 1 },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.udpDstPort, value: 520 }],
};

export const pim: ProtocolDefinition = {
  id: 'pim',
  name: 'PIM',
  fullName: 'Protocol Independent Multicast (v2 header)',
  layerHint: 'network',
  source: 'builtin',
  description:
    'Multicast tree building (IP protocol 103, multicast 224.0.0.13). This is the common header; message bodies (Hello options, Join/Prune lists) follow as payload.',
  fields: [
    { id: 'version', name: 'Ver', type: 'uint', bitLength: 4, default: 2 },
    { id: 'type', name: 'Type', type: 'uint', bitLength: 4, default: 0, enumRef: 'pim-type' },
    { id: 'reserved', name: 'Reserved', type: 'uint', bitLength: 8, default: 0 },
    {
      id: 'checksum', name: 'Checksum', type: 'uint', bitLength: 16,
      computed: { kind: 'checksum', algorithm: 'inet16', scope: 'headerAndPayload' },
    },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.ipProto, value: 103 }],
};

/** Same wire format as DNS with NetBIOS-encoded names. */
export const nbns: ProtocolDefinition = {
  ...dns,
  id: 'nbns',
  name: 'NBNS',
  fullName: 'NetBIOS Name Service',
  description:
    'Legacy Windows name resolution on UDP 137 (WINS). DNS wire format; NetBIOS names are 16 bytes, half-ASCII encoded into a 32-character label.',
  encapsulations: [{ namespaceId: NS.udpDstPort, value: 137 }],
};

/** 802.3 with LLC + SNAP: how vendor protocols like CDP are framed. */
export const ethernetSnap: ProtocolDefinition = {
  id: 'ethernet-snap',
  name: 'Ethernet 802.3 (SNAP)',
  fullName: 'IEEE 802.3 frame with LLC/SNAP header',
  layerHint: 'link',
  source: 'builtin',
  description:
    'LLC with DSAP/SSAP 0xAA extends the frame with a SNAP header: an OUI and a protocol ID, giving vendors their own protocol space. Cisco protocols (CDP, VTP) live here under OUI 00:00:0C.',
  fields: [
    { id: 'dstMac', name: 'Destination MAC', type: 'mac', bitLength: 48, default: '01:00:0c:cc:cc:cc', description: 'Cisco multicast for CDP/VTP by default.' },
    { id: 'srcMac', name: 'Source MAC', type: 'mac', bitLength: 48, default: '02:00:00:00:00:01' },
    {
      id: 'length', name: 'Length', type: 'uint', bitLength: 16,
      computed: { kind: 'expr', expr: { kind: 'binop', op: '+', left: { kind: 'const', value: 8 }, right: { kind: 'payloadBytes' } } },
      description: 'Bytes following: LLC (3) + SNAP (5) + payload.',
    },
    { id: 'dsap', name: 'DSAP', type: 'uint', bitLength: 8, default: 0xaa, description: '0xAA = SNAP.' },
    { id: 'ssap', name: 'SSAP', type: 'uint', bitLength: 8, default: 0xaa },
    { id: 'control', name: 'Control', type: 'uint', bitLength: 8, default: 0x03 },
    { id: 'oui', name: 'OUI', type: 'uint', bitLength: 24, default: 0x00000c, description: 'Organizationally Unique Identifier (00:00:0C = Cisco).' },
    { id: 'pid', name: 'Protocol ID', type: 'uint', bitLength: 16, default: 0x2000, computed: { kind: 'binding' }, description: 'Protocol within the OUI (auto-set; 0x2000 = CDP).' },
  ],
  providesNamespaces: [
    { id: NS.snapPid, displayName: 'SNAP protocol ID', selectorFieldId: 'pid' },
  ],
  encapsulations: [],
};

export const cdp: ProtocolDefinition = {
  id: 'cdp',
  name: 'CDP',
  fullName: 'Cisco Discovery Protocol',
  layerHint: 'link',
  source: 'builtin',
  description:
    'Cisco neighbour discovery over SNAP (PID 0x2000). Modeled with the header and a Device ID TLV; further TLVs (addresses, port, capabilities) can follow as payload.',
  fields: [
    { id: 'version', name: 'Version', type: 'uint', bitLength: 8, default: 2 },
    { id: 'ttl', name: 'TTL', type: 'uint', bitLength: 8, default: 180, description: 'Seconds this announcement stays valid.' },
    {
      id: 'checksum', name: 'Checksum', type: 'uint', bitLength: 16,
      computed: { kind: 'checksum', algorithm: 'inet16', scope: 'headerAndPayload' },
    },
    { id: 'deviceIdType', name: 'Device ID TLV Type', type: 'uint', bitLength: 16, default: 1 },
    { id: 'deviceIdLen', name: 'Device ID TLV Length', type: 'uint', bitLength: 16, default: 11, description: 'TLV length including its 4-byte header (edit if the name length changes).' },
    { id: 'deviceId', name: 'Device ID', type: 'string', bitLength: 'auto', default: 'router1' },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.snapPid, value: 0x2000 }],
};
