import { describe, expect, it } from 'vitest';
import { newLayer, type StackInstance } from '../core/model';
import { serializeStack } from '../core/serialize';
import { validateStack } from '../core/validate';
import { readSpanValue } from '../core/decode';
import { valueToNumber } from '../core/values';
import { createBuiltinRegistry } from './index';

const registry = createBuiltinRegistry();

/** A legal carrier stack exercising every builtin protocol. */
const STACKS: Record<string, string[]> = {
  ethernet: ['ethernet'],
  'vlan-8021q': ['ethernet', 'vlan-8021q', 'ipv4', 'udp'],
  arp: ['ethernet', 'arp'],
  ipv4: ['ethernet', 'ipv4'],
  ipv6: ['ethernet', 'ipv6', 'udp'],
  icmp: ['ethernet', 'ipv4', 'icmp'],
  icmpv6: ['ethernet', 'ipv6', 'icmpv6'],
  igmp: ['ethernet', 'ipv4', 'igmp'],
  tcp: ['ethernet', 'ipv4', 'tcp'],
  udp: ['ethernet', 'ipv4', 'udp'],
  sctp: ['ethernet', 'ipv4', 'sctp'],
  dns: ['ethernet', 'ipv4', 'udp', 'dns'],
  dhcp: ['ethernet', 'ipv4', 'udp', 'dhcp'],
  http1: ['ethernet', 'ipv4', 'tcp', 'http1'],
  tls: ['ethernet', 'ipv4', 'tcp', 'tls', 'http1'],
  ntp: ['ethernet', 'ipv4', 'udp', 'ntp'],
  gre: ['ethernet', 'ipv4', 'gre', 'ipv4', 'icmp'],
  vxlan: ['ethernet', 'ipv4', 'udp', 'vxlan', 'ethernet', 'ipv4', 'udp'],
  mpls: ['ethernet', 'mpls', 'mpls', 'ipv4', 'udp'],
  ospf: ['ethernet', 'ipv4', 'ospf'],
  bgp: ['ethernet', 'ipv4', 'tcp', 'bgp'],
  pppoe: ['ethernet', 'pppoe', 'ipv4', 'udp'],
  l2tp: ['ethernet', 'ipv4', 'udp', 'l2tp'],
  'ethernet-8023': ['ethernet-8023'],
  stp: ['ethernet-8023', 'stp'],
  lldp: ['ethernet', 'lldp'],
  vrrp: ['ethernet', 'ipv4', 'vrrp'],
  hsrp: ['ethernet', 'ipv4', 'udp', 'hsrp'],
  ripv2: ['ethernet', 'ipv4', 'udp', 'ripv2'],
  eigrp: ['ethernet', 'ipv4', 'eigrp'],
  bfd: ['ethernet', 'ipv4', 'udp', 'bfd'],
  dhcpv6: ['ethernet', 'ipv6', 'udp', 'dhcpv6'],
  tftp: ['ethernet', 'ipv4', 'udp', 'tftp'],
  radius: ['ethernet', 'ipv4', 'udp', 'radius'],
  netflow5: ['ethernet', 'ipv4', 'udp', 'netflow5'],
  rtp: ['ethernet', 'ipv4', 'udp', 'rtp'],
  rtcp: ['ethernet', 'ipv4', 'udp', 'rtcp'],
  stun: ['ethernet', 'ipv4', 'udp', 'stun'],
  'ipsec-esp': ['ethernet', 'ipv4', 'ipsec-esp'],
  'ipsec-ah': ['ethernet', 'ipv4', 'ipsec-ah', 'tcp'],
  websocket: ['ethernet', 'ipv4', 'tcp', 'websocket'],
  http2: ['ethernet', 'ipv4', 'tcp', 'tls', 'http2'],
  mqtt: ['ethernet', 'ipv4', 'tcp', 'mqtt'],
  coap: ['ethernet', 'ipv4', 'udp', 'coap'],
  mdns: ['ethernet', 'ipv4', 'udp', 'mdns'],
  llmnr: ['ethernet', 'ipv4', 'udp', 'llmnr'],
  wireguard: ['ethernet', 'ipv4', 'udp', 'wireguard'],
  geneve: ['ethernet', 'ipv4', 'udp', 'geneve', 'ethernet', 'ipv4', 'udp'],
  gtpu: ['ethernet', 'ipv4', 'udp', 'gtpu', 'ipv4', 'udp'],
  modbus: ['ethernet', 'ipv4', 'tcp', 'modbus'],
  smb2: ['ethernet', 'ipv4', 'tcp', 'smb2'],
};

describe('every builtin protocol', () => {
  it('is covered by a test stack', () => {
    const covered = new Set(Object.keys(STACKS));
    for (const p of registry.all()) expect(covered.has(p.id), p.id).toBe(true);
  });

  for (const [id, ids] of Object.entries(STACKS)) {
    describe(id, () => {
      const stack: StackInstance = { layers: ids.map(newLayer) };

      it('validates without errors', () => {
        const errors = validateStack(stack, registry).filter((i) => i.severity === 'error');
        expect(errors).toEqual([]);
      });

      it('serializes without issues', () => {
        const packet = serializeStack(stack, registry);
        expect(packet.issues.filter((i) => i.severity === 'error')).toEqual([]);
        expect(packet.bytes.length).toBeGreaterThan(0);
        // header bytes of all layers tile the packet exactly
        const total = packet.layers.reduce((n, l) => n + l.headerBytes, 0);
        expect(total).toBe(packet.payloadOffset);
      });

      it('round-trips every field through the wire bytes', () => {
        const packet = serializeStack(stack, registry);
        for (const span of packet.spans) {
          const layer = stack.layers.find((l) => l.uid === span.layerUid)!;
          const def = registry.get(layer.protocolId)!;
          const field = def.fields.find((f) => f.id === span.fieldId)!;
          const decoded = readSpanValue(packet.bytes, span, field);

          if (field.type === 'uint' || field.type === 'flags') {
            expect(valueToNumber(field, decoded), `${id}.${field.id}`).toBe(
              valueToNumber(field, span.value),
            );
          } else if (decoded instanceof Uint8Array) {
            if (span.value instanceof Uint8Array) {
              // fixed-length byte fields are zero-padded on the wire
              const expected = new Uint8Array(decoded.length);
              expected.set(span.value.subarray(0, decoded.length));
              expect([...decoded], `${id}.${field.id}`).toEqual([...expected]);
            }
          } else {
            // string-ish types: compare canonical forms
            expect(String(decoded).toLowerCase(), `${id}.${field.id}`).toBe(
              String(span.value).toLowerCase(),
            );
          }
        }
      });
    });
  }
});

describe('protocol-specific spot checks', () => {
  it('VXLAN tunnel sets outer UDP port 4789 and inner frames serialize', () => {
    const stack: StackInstance = { layers: STACKS['vxlan']!.map(newLayer) };
    const { bytes, layers } = serializeStack(stack, registry);
    const udpStart = layers[2]!.byteOffset;
    expect((bytes[udpStart + 2]! << 8) | bytes[udpStart + 3]!).toBe(4789);
    // inner Ethernet starts right after the 8-byte VXLAN header
    expect(layers[4]!.byteOffset).toBe(layers[3]!.byteOffset + 8);
  });

  it('GRE sets protocol type from the inner layer', () => {
    const stack: StackInstance = { layers: STACKS['gre']!.map(newLayer) };
    const { bytes, layers } = serializeStack(stack, registry);
    const greStart = layers[2]!.byteOffset;
    expect((bytes[greStart + 2]! << 8) | bytes[greStart + 3]!).toBe(0x0800);
    expect(layers[2]!.headerBytes).toBe(4); // no checksum by default
  });

  it('GRE grows by 4 bytes when the C bit is set', () => {
    const layers = STACKS['gre']!.map(newLayer);
    layers[2]!.overrides['checksumPresent'] = 1;
    const { layers: out } = serializeStack({ layers }, registry);
    expect(out[2]!.headerBytes).toBe(8);
  });

  it('MPLS label stack: user can clear S on the outer label', () => {
    const layers = STACKS['mpls']!.map(newLayer);
    layers[1]!.overrides['s'] = 0;
    const { bytes, layers: out } = serializeStack({ layers }, registry);
    const outer = out[1]!.byteOffset;
    expect(bytes[outer + 2]! & 1).toBe(0);
    expect(bytes[outer + 6]! & 1).toBe(1); // inner label keeps S=1
  });

  it('PPPoE length covers PPP protocol field plus payload', () => {
    const stack: StackInstance = { layers: STACKS['pppoe']!.map(newLayer) };
    const { bytes, layers } = serializeStack(stack, registry);
    const pppoeStart = layers[1]!.byteOffset;
    const length = (bytes[pppoeStart + 4]! << 8) | bytes[pppoeStart + 5]!;
    const rest = bytes.length - pppoeStart - 6;
    expect(length).toBe(rest);
  });

  it('L2TP drops the length field when L is cleared', () => {
    const layers = STACKS['l2tp']!.map(newLayer);
    const base = serializeStack({ layers }, registry).layers[3]!.headerBytes;
    layers[3]!.overrides['l'] = 0;
    const smaller = serializeStack({ layers }, registry).layers[3]!.headerBytes;
    expect(base - smaller).toBe(2);
  });

  it('DNS question name encodes as labels', () => {
    const stack: StackInstance = { layers: STACKS['dns']!.map(newLayer) };
    const { bytes, spans } = serializeStack(stack, registry);
    const qname = spans.find((s) => s.fieldId === 'qname')!;
    const start = qname.bitOffset / 8;
    expect(bytes[start]).toBe(7); // "example"
    expect(bytes[start + 8]).toBe(3); // "com"
    expect(bytes[start + 12]).toBe(0); // root
  });

  it('BGP KEEPALIVE is exactly 19 bytes with correct length field', () => {
    const stack: StackInstance = { layers: STACKS['bgp']!.map(newLayer) };
    const { bytes, layers } = serializeStack(stack, registry);
    const start = layers[3]!.byteOffset;
    expect(layers[3]!.headerBytes).toBe(19);
    expect((bytes[start + 16]! << 8) | bytes[start + 17]!).toBe(19);
    expect(bytes[start + 18]).toBe(4);
  });

  it('TLS record length counts the HTTP request inside it', () => {
    const stack: StackInstance = { layers: STACKS['tls']!.map(newLayer) };
    const { bytes, layers } = serializeStack(stack, registry);
    const tlsStart = layers[3]!.byteOffset;
    const recLen = (bytes[tlsStart + 3]! << 8) | bytes[tlsStart + 4]!;
    expect(recLen).toBe(bytes.length - tlsStart - 5);
    expect(recLen).toBeGreaterThan(0);
  });

  it('DHCP fixed header is 240 bytes to the end of the magic cookie', () => {
    const stack: StackInstance = { layers: STACKS['dhcp']!.map(newLayer) };
    const { layers } = serializeStack(stack, registry);
    expect(layers[3]!.headerBytes).toBe(240 + 4); // + default options TLV
  });

  it('802.3 length counts LLC header plus BPDU, and DSAP auto-sets to 0x42', () => {
    const stack: StackInstance = { layers: STACKS['stp']!.map(newLayer) };
    const { bytes, layers } = serializeStack(stack, registry);
    const length = (bytes[12]! << 8) | bytes[13]!;
    expect(length).toBe(bytes.length - 14);
    expect(bytes[14]).toBe(0x42); // DSAP from binding
    expect(layers[1]!.headerBytes).toBe(35); // config BPDU
  });

  it('AH next-header auto-sets to the protected protocol', () => {
    const stack: StackInstance = { layers: STACKS['ipsec-ah']!.map(newLayer) };
    const { bytes, layers } = serializeStack(stack, registry);
    const ahStart = layers[2]!.byteOffset;
    expect(bytes[ahStart]).toBe(6); // TCP inside
    expect(bytes[ahStart + 1]).toBe(layers[2]!.headerBytes / 4 - 2);
  });

  it('TCP checksum inside AH uses protocol 6 in the pseudo-header', () => {
    const stack: StackInstance = { layers: STACKS['ipsec-ah']!.map(newLayer) };
    const { bytes, layers } = serializeStack(stack, registry);
    const tcpStart = layers[3]!.byteOffset;
    const segment = bytes.length - tcpStart;
    // ones-complement over pseudo-header (src, dst, 0, 6, len) + TCP segment
    let sum = 0;
    const ipStart = layers[1]!.byteOffset;
    for (const off of [12, 14, 16, 18]) {
      sum += (bytes[ipStart + off]! << 8) | bytes[ipStart + off + 1]!;
    }
    sum += 6 + segment;
    for (let i = tcpStart; i < bytes.length; i += 2) {
      sum += (bytes[i]! << 8) | (bytes[i + 1] ?? 0);
    }
    while (sum > 0xffff) sum = (sum & 0xffff) + (sum >> 16);
    expect(sum).toBe(0xffff);
  });

  it('GENEVE protocol type auto-sets to 0x6558 for inner Ethernet', () => {
    const stack: StackInstance = { layers: STACKS['geneve']!.map(newLayer) };
    const { bytes, layers } = serializeStack(stack, registry);
    const gStart = layers[3]!.byteOffset;
    expect((bytes[gStart + 2]! << 8) | bytes[gStart + 3]!).toBe(0x6558);
    expect(layers[4]!.byteOffset).toBe(gStart + 8);
  });

  it('GTP-U length covers the tunnelled IP packet', () => {
    const stack: StackInstance = { layers: STACKS['gtpu']!.map(newLayer) };
    const { bytes, layers } = serializeStack(stack, registry);
    const gStart = layers[3]!.byteOffset;
    const length = (bytes[gStart + 2]! << 8) | bytes[gStart + 3]!;
    expect(length).toBe(bytes.length - gStart - 8);
  });

  it('VRRP checksum verifies as ones-complement over the packet', () => {
    const stack: StackInstance = { layers: STACKS['vrrp']!.map(newLayer) };
    const { bytes, layers } = serializeStack(stack, registry);
    const start = layers[2]!.byteOffset;
    let sum = 0;
    for (let i = start; i < bytes.length; i += 2) {
      sum += (bytes[i]! << 8) | (bytes[i + 1] ?? 0);
    }
    while (sum > 0xffff) sum = (sum & 0xffff) + (sum >> 16);
    expect(sum).toBe(0xffff);
  });

  it('mDNS shares the DNS wire format but binds to port 5353', () => {
    const stack: StackInstance = { layers: STACKS['mdns']!.map(newLayer) };
    const { bytes, layers } = serializeStack(stack, registry);
    const udpStart = layers[2]!.byteOffset;
    expect((bytes[udpStart + 2]! << 8) | bytes[udpStart + 3]!).toBe(5353);
  });
});
