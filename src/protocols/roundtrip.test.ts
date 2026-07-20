import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newLayer, type StackInstance } from '../core/model';
import { planExport } from '../core/exporter';
import { writePcap } from '../core/pcap';
import { scenarios } from '../core/scenarios';
import { serializeStack } from '../core/serialize';
import { validateStack } from '../core/validate';
import { readSpanValue } from '../core/decode';
import { valueToNumber } from '../core/values';
import { createBuiltinRegistry } from './index';

const registry = createBuiltinRegistry();

const TSHARK_PROTOCOL_NAMES: Record<string, string> = {
  ethernet: 'eth',
  'vlan-8021q': 'vlan',
  ipv4: 'ip',
  'icmpv6-ndp': 'icmpv6',
  igmpv3: 'igmp',
  mldv2: 'icmpv6',
  http1: 'http',
  pppoe: 'pppoes',
  'ethernet-8023': 'llc',
  ripv2: 'rip',
  netflow5: 'cflow',
  'ipsec-esp': 'esp',
  'ipsec-ah': 'ah',
  http2: 'tls',
  wireguard: 'wg',
  gtpu: 'gtp',
  pop3: 'pop',
  ripv1: 'rip',
  'ethernet-snap': 'cdp',
  'ipv6-hopopts': 'ipv6.hopopts',
  'ipv6-routing': 'ipv6.routing',
  'ipv6-frag': 'ipv6.fraghdr',
  'ipv6-dstopts': 'ipv6.dstopts',
};

/** A legal carrier stack exercising every builtin protocol. */
const STACKS: Record<string, string[]> = {
  ethernet: ['ethernet'],
  'vlan-8021q': ['ethernet', 'vlan-8021q', 'ipv4', 'udp'],
  arp: ['ethernet', 'arp'],
  ipv4: ['ethernet', 'ipv4'],
  ipv6: ['ethernet', 'ipv6', 'udp'],
  icmp: ['ethernet', 'ipv4', 'icmp'],
  icmpv6: ['ethernet', 'ipv6', 'icmpv6'],
  'icmpv6-ndp': ['ethernet', 'ipv6', 'icmpv6-ndp'],
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
  ftp: ['ethernet', 'ipv4', 'tcp', 'ftp'],
  smtp: ['ethernet', 'ipv4', 'tcp', 'smtp'],
  pop3: ['ethernet', 'ipv4', 'tcp', 'pop3'],
  imap: ['ethernet', 'ipv4', 'tcp', 'imap'],
  telnet: ['ethernet', 'ipv4', 'tcp', 'telnet'],
  irc: ['ethernet', 'ipv4', 'tcp', 'irc'],
  sip: ['ethernet', 'ipv4', 'udp', 'sip'],
  rtsp: ['ethernet', 'ipv4', 'tcp', 'rtsp'],
  syslog: ['ethernet', 'ipv4', 'udp', 'syslog'],
  ssdp: ['ethernet', 'ipv4', 'udp', 'ssdp'],
  ripv1: ['ethernet', 'ipv4', 'udp', 'ripv1'],
  pim: ['ethernet', 'ipv4', 'pim'],
  nbns: ['ethernet', 'ipv4', 'udp', 'nbns'],
  'ethernet-snap': ['ethernet-snap'],
  cdp: ['ethernet-snap', 'cdp'],
  'ipv6-hopopts': ['ethernet', 'ipv6', 'ipv6-hopopts', 'udp'],
  'ipv6-routing': ['ethernet', 'ipv6', 'ipv6-routing', 'tcp'],
  'ipv6-frag': ['ethernet', 'ipv6', 'ipv6-frag', 'udp'],
  'ipv6-dstopts': ['ethernet', 'ipv6', 'ipv6-dstopts', 'tcp'],
  quic: ['ethernet', 'ipv4', 'udp', 'quic'],
  isis: ['ethernet-8023', 'isis'],
  igmpv3: ['ethernet', 'ipv4', 'igmpv3'],
  mldv2: ['ethernet', 'ipv6', 'mldv2'],
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

describe.runIf(process.env.TSHARK === '1')('tshark export validation', () => {
  it('independently dissects every builtin stack without malformed packets or bad checksums', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'proto-viz-tshark-'));
    const failures: string[] = [];
    try {
      for (const [id, ids] of Object.entries(STACKS)) {
        const externalIds =
          id === 'ethernet'
            ? [...ids, 'ipv4', 'udp']
            : id === 'ethernet-snap'
              ? [...ids, 'cdp']
              : ids;
        const stack: StackInstance = { layers: externalIds.map(newLayer) };
        if (id === 'ospf') stack.trailingPayload = new Uint8Array(20);
        if (id === 'mqtt') stack.layers.at(-1)!.overrides.packetType = 14;
        if (id === 'modbus') stack.trailingPayload = new Uint8Array([0, 0, 0, 1]);
        if (id === 'mpls') stack.layers[1]!.overrides.s = 0;
        if (id === 'isis') {
          stack.layers[0]!.overrides.dstMac = '01:80:c2:00:00:14';
          stack.layers[0]!.overrides.ssap = 0xfe;
        }
        if (id === 'hsrp') stack.layers[1]!.overrides.dst = '224.0.0.2';
        if (id === 'smb2') {
          stack.layers.at(-1)!.overrides.command = new Uint8Array([13, 0]);
          stack.trailingPayload = new Uint8Array([4, 0, 0, 0]);
        }
        const packet = serializeStack(stack, registry);
        const exportPlan = planExport(stack, registry);
        expect(exportPlan.ok, `${id}: ${exportPlan.blockedReason}`).toBe(true);

        const capture = writePcap(
          [{ bytes: packet.bytes, tsSec: 1_700_000_000, tsUsec: 0 }],
          exportPlan.linkType!,
        );
        const path = join(directory, `${id}.pcap`);
        await writeFile(path, capture);

        const decodeAs =
          id === 'rtp'
            ? ['-d', 'udp.port==5004,rtp']
            : id === 'hsrp'
              ? ['-d', 'udp.port==1985,hsrp']
              : id === 'websocket'
                ? ['-d', 'tcp.port==80,websocket']
                : [];
        const fields = execFileSync(
          'tshark',
          [
            '-r', path,
            ...decodeAs,
            '-o', 'tcp.check_checksum:TRUE',
            '-o', 'udp.check_checksum:TRUE',
            '-o', 'ip.check_checksum:TRUE',
            '-T', 'fields',
            '-e', 'frame.protocols',
            '-e', '_ws.malformed',
            '-e', 'ip.checksum.status',
            '-e', 'tcp.checksum.status',
            '-e', 'udp.checksum.status',
            '-E', 'separator=|',
          ],
          { encoding: 'utf8' },
        ).trim();
        const [protocols = '', malformed = '', ipStatus = '', tcpStatus = '', udpStatus = ''] =
          fields.split('|');
        const expectedProtocol = TSHARK_PROTOCOL_NAMES[id] ?? id;

        if (malformed) failures.push(`${id}: malformed (${protocols})`);
        if (ipStatus === '0') failures.push(`${id}: bad IPv4 checksum (${protocols})`);
        if (tcpStatus === '0') failures.push(`${id}: bad TCP checksum (${protocols})`);
        if (udpStatus === '0') failures.push(`${id}: bad UDP checksum (${protocols})`);
        if (!protocols) failures.push(`${id}: no protocols dissected`);
        if (!protocols.split(':').includes(expectedProtocol)) {
          failures.push(`${id}: expected ${expectedProtocol} in ${protocols}`);
        }
      }

      const scenarioStacks: Record<string, StackInstance> = {
        single: { layers: ['ethernet', 'ipv4', 'udp'].map(newLayer) },
        'arp-resolution': { layers: ['ethernet', 'ipv4', 'tcp'].map(newLayer) },
        'ndp-exchange': { layers: ['ethernet', 'ipv6', 'udp'].map(newLayer) },
        'tcp-handshake': { layers: ['ethernet', 'ipv4', 'tcp'].map(newLayer) },
        'tcp-session': {
          layers: ['ethernet', 'ipv4', 'tcp'].map(newLayer),
          trailingPayload: new TextEncoder().encode('hello'),
        },
        'tls-hello-exchange': { layers: ['ethernet', 'ipv4', 'tcp', 'tls'].map(newLayer) },
        'icmp-ping': { layers: ['ethernet', 'ipv4', 'icmp'].map(newLayer) },
        'dns-query-response': { layers: ['ethernet', 'ipv4', 'udp', 'dns'].map(newLayer) },
        'dhcp-dora': { layers: ['ethernet', 'ipv4', 'udp', 'dhcp'].map(newLayer) },
      };
      const scenarioProtocols: Record<string, string[]> = {
        single: ['udp'],
        'arp-resolution': ['arp', 'tcp'],
        'ndp-exchange': ['icmpv6', 'udp'],
        'tcp-handshake': ['tcp'],
        'tcp-session': ['tcp'],
        'tls-hello-exchange': ['tls'],
        'icmp-ping': ['icmp'],
        'dns-query-response': ['dns'],
        'dhcp-dora': ['dhcp'],
      };
      for (const scenario of scenarios) {
        const stack = scenarioStacks[scenario.id];
        expect(stack, `${scenario.id}: missing tshark fixture`).toBeDefined();
        const packets = scenario.generate(stack!, registry).map((plan) => ({
          bytes: serializeStack(plan.stack, registry).bytes,
          tsSec: 1_700_000_000,
          tsUsec: plan.atUsec,
        }));
        const path = join(directory, `scenario-${scenario.id}.pcap`);
        await writeFile(path, writePcap(packets, 1));
        const rows = execFileSync(
          'tshark',
          [
            '-r', path,
            '-o', 'tcp.check_checksum:TRUE',
            '-o', 'udp.check_checksum:TRUE',
            '-o', 'ip.check_checksum:TRUE',
            '-T', 'fields',
            '-e', 'frame.protocols',
            '-e', '_ws.malformed',
            '-e', 'ip.checksum.status',
            '-e', 'tcp.checksum.status',
            '-e', 'udp.checksum.status',
            '-E', 'separator=|',
          ],
          { encoding: 'utf8' },
        ).trim().split('\n');
        const dissectedProtocols: string[] = [];
        for (const [index, row] of rows.entries()) {
          const [protocols = '', malformed = '', ipStatus = '', tcpStatus = '', udpStatus = ''] =
            row.split('|');
          const label = `${scenario.id} packet ${index + 1}`;
          dissectedProtocols.push(...protocols.split(':'));
          if (malformed) failures.push(`${label}: malformed (${protocols})`);
          if ([ipStatus, tcpStatus, udpStatus].some((status) => status.split(',').includes('0'))) {
            failures.push(`${label}: bad checksum (${protocols})`);
          }
          if (!protocols) failures.push(`${label}: no protocols dissected`);
        }
        for (const expectedProtocol of scenarioProtocols[scenario.id] ?? []) {
          if (!dissectedProtocols.includes(expectedProtocol)) {
            failures.push(`${scenario.id}: expected ${expectedProtocol} in scenario dissection`);
          }
        }
      }
      expect(failures).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('detects a deliberately corrupted TCP checksum', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'proto-viz-tshark-canary-'));
    try {
      const stack: StackInstance = { layers: ['ethernet', 'ipv4', 'tcp'].map(newLayer) };
      const bytes = serializeStack(stack, registry).bytes;
      bytes[50] = bytes[50]! ^ 0xff;
      const path = join(directory, 'bad-checksum.pcap');
      await writeFile(path, writePcap([{ bytes, tsSec: 1_700_000_000, tsUsec: 0 }], 1));
      const checksumStatus = execFileSync(
        'tshark',
        ['-r', path, '-o', 'tcp.check_checksum:TRUE', '-T', 'fields', '-e', 'tcp.checksum.status'],
        { encoding: 'utf8' },
      ).trim();
      expect(checksumStatus).toBe('0');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
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

  it('IS-IS binds to LLC SAP 0xFE and computes the complete IIH PDU length', () => {
    const layers = STACKS.isis!.map(newLayer);
    layers[0]!.overrides.ssap = 0xfe;
    const { bytes, layers: layouts } = serializeStack({ layers }, registry);
    const start = layouts[1]!.byteOffset;
    expect(bytes[14]).toBe(0xfe); // DSAP from binding
    expect(bytes[15]).toBe(0xfe); // canonical SSAP override
    expect(bytes[start]).toBe(0x83); // IS-IS NLPID
    expect(bytes[start + 4]! & 0x1f).toBe(15); // L1 LAN IIH
    expect((bytes[start + 17]! << 8) | bytes[start + 18]!).toBe(
      layouts[1]!.headerBytes,
    );
    expect(layouts[1]!.headerBytes).toBe(36); // 27 fixed + 9 TLV bytes
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

  it('IPv6 extension-header chain auto-sets each Next Header', () => {
    const stack: StackInstance = {
      layers: ['ethernet', 'ipv6', 'ipv6-hopopts', 'ipv6-frag', 'tcp'].map(newLayer),
    };
    const errors = validateStack(stack, registry).filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
    const { bytes, layers } = serializeStack(stack, registry);
    expect(bytes[layers[1]!.byteOffset + 6]).toBe(0); // IPv6 Next Header → Hop-by-Hop
    expect(bytes[layers[2]!.byteOffset]).toBe(44); // Hop-by-Hop Next Header → Fragment
    expect(bytes[layers[3]!.byteOffset]).toBe(6); // Fragment Next Header → TCP
  });

  it('Hop-by-Hop Hdr Ext Len is in 8-octet units minus the first 8', () => {
    const stack: StackInstance = {
      layers: ['ethernet', 'ipv6', 'ipv6-hopopts', 'udp'].map(newLayer),
    };
    const { bytes, layers } = serializeStack(stack, registry);
    const hopBytes = layers[2]!.headerBytes;
    expect(hopBytes % 8).toBe(0); // header is a whole number of 8-octet units
    expect(bytes[layers[2]!.byteOffset + 1]).toBe(hopBytes / 8 - 1);
  });

  it('TCP checksum under an extension-header chain uses Next Header 6', () => {
    const stack: StackInstance = {
      layers: ['ethernet', 'ipv6', 'ipv6-hopopts', 'ipv6-routing', 'tcp'].map(newLayer),
    };
    // Pin the routing header to its final destination (Segments Left 0) so the
    // pseudo-header uses the IPv6 Destination Address — this isolates the Next
    // Header check from the final-destination substitution tested separately.
    stack.layers[3]!.overrides.segmentsLeft = 0;
    const { bytes, layers } = serializeStack(stack, registry);
    const ipStart = layers[1]!.byteOffset;
    const tcpStart = layers[4]!.byteOffset;
    const segment = bytes.length - tcpStart;
    // ones-complement over the IPv6 pseudo-header (src, dst, upper-layer
    // length, zeros, Next Header 6) + the TCP segment. The Next Header must
    // be the transport's own value, not the 0/43 named by the chain.
    let sum = 0;
    for (let off = 8; off < 40; off += 2) {
      sum += (bytes[ipStart + off]! << 8) | bytes[ipStart + off + 1]!;
    }
    sum += (segment >>> 16) + (segment & 0xffff);
    sum += 6;
    for (let i = tcpStart; i < bytes.length; i += 2) {
      sum += (bytes[i]! << 8) | (bytes[i + 1] ?? 0);
    }
    while (sum > 0xffff) sum = (sum & 0xffff) + (sum >> 16);
    expect(sum).toBe(0xffff);
  });

  it('SRv6 routing header checksums against the final segment while Segments Left > 0', () => {
    // Fold a TCP pseudo-header + segment sum given the src/dst address offsets,
    // returning 0xffff when the stored checksum is correct for those addresses.
    const foldedTcpSum = (bytes: Uint8Array, srcOff: number, dstOff: number, tcpStart: number) => {
      let sum = 0;
      for (let o = 0; o < 16; o += 2) sum += (bytes[srcOff + o]! << 8) | bytes[srcOff + o + 1]!;
      for (let o = 0; o < 16; o += 2) sum += (bytes[dstOff + o]! << 8) | bytes[dstOff + o + 1]!;
      const seg = bytes.length - tcpStart;
      sum += (seg >>> 16) + (seg & 0xffff) + 6;
      for (let i = tcpStart; i < bytes.length; i += 2) sum += (bytes[i]! << 8) | (bytes[i + 1] ?? 0);
      while (sum > 0xffff) sum = (sum & 0xffff) + (sum >> 16);
      return sum;
    };
    const ids = ['ethernet', 'ipv6', 'ipv6-routing', 'tcp'];

    // Default Segments Left is 1 (in flight): the checksum must use the last
    // segment (Segment List [0], at routing offset +8), not the IPv6 dst.
    const inFlight: StackInstance = { layers: ids.map(newLayer) };
    let p = serializeStack(inFlight, registry);
    let ipStart = p.layers[1]!.byteOffset;
    const rtStart = p.layers[2]!.byteOffset;
    let tcpStart = p.layers[3]!.byteOffset;
    expect(foldedTcpSum(p.bytes, ipStart + 8, rtStart + 8, tcpStart)).toBe(0xffff);
    // The substitution is real: it is NOT valid against the IPv6 dst, which
    // differs from the final segment.
    expect(foldedTcpSum(p.bytes, ipStart + 8, ipStart + 24, tcpStart)).not.toBe(0xffff);

    // Segments Left 0 (final destination reached): use the IPv6 dst.
    const arrived: StackInstance = { layers: ids.map(newLayer) };
    arrived.layers[2]!.overrides.segmentsLeft = 0;
    p = serializeStack(arrived, registry);
    ipStart = p.layers[1]!.byteOffset;
    tcpStart = p.layers[3]!.byteOffset;
    expect(foldedTcpSum(p.bytes, ipStart + 8, ipStart + 24, tcpStart)).toBe(0xffff);
  });

  it('IGMPv3 report carries a group record with a valid checksum', () => {
    const stack: StackInstance = { layers: STACKS['igmpv3']!.map(newLayer) };
    const { bytes, layers } = serializeStack(stack, registry);
    const g = layers[2]!.byteOffset;
    expect(bytes[g]).toBe(0x22); // v3 membership report
    expect((bytes[g + 6]! << 8) | bytes[g + 7]!).toBe(1); // one group record
    // Independent ones-complement over the whole IGMP message.
    let sum = 0;
    for (let i = g; i < bytes.length; i += 2) sum += (bytes[i]! << 8) | (bytes[i + 1] ?? 0);
    while (sum > 0xffff) sum = (sum & 0xffff) + (sum >> 16);
    expect(sum).toBe(0xffff);
  });

  it('MLDv2 report is ICMPv6 type 143 with an address record', () => {
    const stack: StackInstance = { layers: STACKS['mldv2']!.map(newLayer) };
    const { bytes, layers } = serializeStack(stack, registry);
    const mld = layers[2]!.byteOffset; // [ethernet, ipv6, mldv2]
    expect(bytes[mld]).toBe(143); // MLDv2 Multicast Listener Report
    expect((bytes[mld + 6]! << 8) | bytes[mld + 7]!).toBe(1); // one address record
  });

  it('QUIC long-header Initial sets the first byte, version, and UDP port 443', () => {
    const stack: StackInstance = { layers: STACKS['quic']!.map(newLayer) };
    const { bytes, layers } = serializeStack(stack, registry);
    const udpStart = layers[2]!.byteOffset;
    expect((bytes[udpStart + 2]! << 8) | bytes[udpStart + 3]!).toBe(443); // dst port auto-set
    const q = layers[3]!.byteOffset;
    expect(bytes[q]).toBe(0xc0); // long header + fixed bit + Initial (type 0)
    // Version 0x00000001 in the next four bytes.
    expect([bytes[q + 1], bytes[q + 2], bytes[q + 3], bytes[q + 4]]).toEqual([0, 0, 0, 1]);
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

  it('CDP travels over SNAP with PID auto-set to 0x2000', () => {
    const stack: StackInstance = { layers: STACKS['cdp']!.map(newLayer) };
    const { bytes, layers } = serializeStack(stack, registry);
    expect(bytes[14]).toBe(0xaa); // DSAP = SNAP
    expect((bytes[20]! << 8) | bytes[21]!).toBe(0x2000); // PID from binding
    const length = (bytes[12]! << 8) | bytes[13]!;
    expect(length).toBe(bytes.length - 14);
    // CDP checksum verifies as ones-complement over the CDP portion
    const start = layers[1]!.byteOffset;
    let sum = 0;
    for (let i = start; i < bytes.length; i += 2) {
      sum += (bytes[i]! << 8) | (bytes[i + 1] ?? 0);
    }
    while (sum > 0xffff) sum = (sum & 0xffff) + (sum >> 16);
    expect(sum).toBe(0xffff);
  });

  it('SIP serializes its text template with CRLF CRLF terminator', () => {
    const stack: StackInstance = { layers: STACKS['sip']!.map(newLayer) };
    const { bytes, layers } = serializeStack(stack, registry);
    const text = new TextDecoder().decode(bytes.subarray(layers[3]!.byteOffset));
    expect(text.startsWith('INVITE sip:bob@example.com SIP/2.0\r\n')).toBe(true);
    expect(text.endsWith('\r\n\r\n')).toBe(true);
  });

  it('mDNS shares the DNS wire format but binds to port 5353', () => {
    const stack: StackInstance = { layers: STACKS['mdns']!.map(newLayer) };
    const { bytes, layers } = serializeStack(stack, registry);
    const udpStart = layers[2]!.byteOffset;
    expect((bytes[udpStart + 2]! << 8) | bytes[udpStart + 3]!).toBe(5353);
  });
});
