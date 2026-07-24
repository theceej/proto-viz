/**
 * Curated example stacks for the builder's Presets picker. Each entry is a
 * canonical packet a learner can load in one click: the layer structure, a
 * short description of what it demonstrates, a category for grouping, and
 * optionally per-layer field overrides/pins and a trailing payload.
 *
 * Most presets need no overrides — protocol field defaults are already
 * realistic (real HTTP/1.1 request text, an example.com DNS query, TEST-NET
 * addresses, a set TCP SYN flag) and carrier selector ports are filled in by
 * the binding model. Overrides are only spelled out where an example differs
 * from the defaults, such as an established TCP segment versus the opening SYN.
 *
 * Adding an example is a pure data entry here — the picker renders whatever
 * this list contains, grouped by `group` in `PRESET_GROUPS` order.
 */
import type { FieldValue } from './model';

const utf8 = (text: string) => new TextEncoder().encode(text);

export interface PresetLayer {
  protocolId: string;
  overrides?: Record<string, FieldValue>;
  pinned?: string[];
}

export interface Preset {
  name: string;
  group: (typeof PRESET_GROUPS)[number];
  description: string;
  layers: PresetLayer[];
  payload?: Uint8Array;
}

/** Category order for the grouped picker. */
export const PRESET_GROUPS = [
  'Basics',
  'VLANs & tunnels',
  'Security',
  'Routing & infrastructure',
  'Media',
] as const;

const l = (
  protocolId: string,
  overrides?: Record<string, FieldValue>,
  pinned?: string[],
): PresetLayer => ({ protocolId, overrides, pinned });

export const PRESETS: Preset[] = [
  {
    name: 'TCP over Ethernet',
    group: 'Basics',
    description: 'A bare TCP SYN — the opening segment of the three-way handshake.',
    layers: [l('ethernet'), l('ipv4'), l('tcp')],
  },
  {
    name: 'TCP data segment',
    group: 'Basics',
    description: 'An established connection: ACK and PSH set, carrying application bytes.',
    layers: [l('ethernet'), l('ipv4'), l('tcp', { flags: 0x18, seq: 1001, ack: 5001 })],
    payload: utf8('hello world'),
  },
  {
    name: 'TCP connection reset',
    group: 'Basics',
    description: 'An abortive close: the RST flag (with ACK) tears the connection down.',
    layers: [l('ethernet'), l('ipv4'), l('tcp', { flags: 0x14, ack: 5001 })],
  },
  {
    name: 'HTTP request',
    group: 'Basics',
    description: 'A GET request over TCP — the start line and headers are real HTTP/1.1 text.',
    layers: [l('ethernet'), l('ipv4'), l('tcp'), l('http1')],
  },
  {
    name: 'DNS query',
    group: 'Basics',
    description: 'A recursive A-record query for example.com over UDP.',
    layers: [l('ethernet'), l('ipv4'), l('udp'), l('dns')],
  },
  {
    name: 'ICMP ping',
    group: 'Basics',
    description: 'An ICMP echo request (type 8) with a short data payload.',
    layers: [l('ethernet'), l('ipv4'), l('icmp')],
    payload: utf8('abcdefgh'),
  },
  {
    name: 'IPv6 ping',
    group: 'Basics',
    description: 'An ICMPv6 echo request over IPv6.',
    layers: [l('ethernet'), l('ipv6'), l('icmpv6')],
    payload: utf8('abcdefgh'),
  },
  {
    name: 'DHCP discover',
    group: 'Basics',
    description: 'A broadcast DHCP client message over UDP.',
    layers: [l('ethernet'), l('ipv4'), l('udp'), l('dhcp')],
  },
  {
    name: 'VLAN-tagged TCP',
    group: 'VLANs & tunnels',
    description: 'An 802.1Q VLAN tag inserted between Ethernet and IPv4.',
    layers: [l('ethernet'), l('vlan-8021q'), l('ipv4'), l('tcp')],
  },
  {
    name: 'Q-in-Q',
    group: 'VLANs & tunnels',
    description: 'Two stacked 802.1Q tags — 802.1ad provider bridging.',
    layers: [l('ethernet'), l('vlan-8021q'), l('vlan-8021q'), l('ipv4'), l('udp')],
  },
  {
    name: 'VXLAN overlay',
    group: 'VLANs & tunnels',
    description: 'A complete inner Ethernet frame tunnelled inside VXLAN over UDP.',
    layers: [
      l('ethernet'),
      l('ipv4'),
      l('udp'),
      l('vxlan'),
      l('ethernet'),
      l('ipv4'),
      l('udp'),
    ],
    payload: utf8('inner payload'),
  },
  {
    name: 'GRE tunnel (IP-in-IP)',
    group: 'VLANs & tunnels',
    description: 'An inner IPv4/ICMP packet carried over a GRE tunnel.',
    layers: [l('ethernet'), l('ipv4'), l('gre'), l('ipv4'), l('icmp')],
  },
  {
    name: 'MPLS label stack',
    group: 'VLANs & tunnels',
    description: 'An MPLS label ahead of the IPv4 payload.',
    layers: [l('ethernet'), l('mpls'), l('ipv4'), l('udp')],
  },
  {
    name: 'PPPoE session',
    group: 'VLANs & tunnels',
    description: 'A PPPoE session frame carrying IPv4 over UDP.',
    layers: [l('ethernet'), l('pppoe'), l('ipv4'), l('udp')],
  },
  {
    name: 'Mobile data (GTP-U)',
    group: 'VLANs & tunnels',
    description: 'A subscriber IPv4/TCP packet inside a GTP-U tunnel.',
    layers: [l('ethernet'), l('ipv4'), l('udp'), l('gtpu'), l('ipv4'), l('tcp')],
  },
  {
    name: 'HTTPS (TLS record)',
    group: 'Security',
    description: 'A TLS record wrapping HTTP over TCP.',
    layers: [l('ethernet'), l('ipv4'), l('tcp'), l('tls'), l('http1')],
  },
  {
    name: 'WireGuard handshake',
    group: 'Security',
    description: 'A WireGuard handshake-initiation message over UDP.',
    layers: [l('ethernet'), l('ipv4'), l('udp'), l('wireguard')],
  },
  {
    name: 'IPsec AH transport',
    group: 'Security',
    description: 'IPsec Authentication Header in transport mode ahead of TCP.',
    layers: [l('ethernet'), l('ipv4'), l('ipsec-ah'), l('tcp')],
  },
  {
    name: 'BGP keepalive',
    group: 'Routing & infrastructure',
    description: 'A BGP keepalive message over a TCP session.',
    layers: [l('ethernet'), l('ipv4'), l('tcp'), l('bgp')],
  },
  {
    name: 'Spanning tree BPDU',
    group: 'Routing & infrastructure',
    description: 'An STP configuration BPDU over 802.3 with an LLC header.',
    layers: [l('ethernet-8023'), l('stp')],
  },
  {
    name: 'VoIP audio (RTP)',
    group: 'Media',
    description: 'An RTP media packet carrying audio samples over UDP.',
    layers: [l('ethernet'), l('ipv4'), l('udp'), l('rtp')],
    payload: utf8('samples…'),
  },
];

/** A preset's layers in the shape `restoreStack` expects. */
export function presetStackLayers(
  preset: Preset,
): { protocolId: string; overrides: Record<string, FieldValue>; pinned: string[] }[] {
  return preset.layers.map((layer) => ({
    protocolId: layer.protocolId,
    overrides: layer.overrides ?? {},
    pinned: layer.pinned ?? [],
  }));
}
