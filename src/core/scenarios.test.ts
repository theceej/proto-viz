import { describe, expect, it } from 'vitest';
import { newLayer, type StackInstance } from './model';
import { serializeStack } from './serialize';
import { applicableScenarios, scenarios } from './scenarios';
import { createBuiltinRegistry } from '../protocols';

const registry = createBuiltinRegistry();

const stack = (ids: string[], payload?: string): StackInstance => ({
  layers: ids.map(newLayer),
  trailingPayload: payload ? new TextEncoder().encode(payload) : undefined,
});

const byId = (id: string) => scenarios.find((s) => s.id === id)!;

describe('scenarios', () => {
  it('offers only applicable scenarios', () => {
    const ids = applicableScenarios(stack(['ethernet', 'ipv4', 'udp']), registry).map(
      (s) => s.id,
    );
    expect(ids).toContain('single');
    expect(ids).toContain('arp-resolution');
    expect(ids).not.toContain('tcp-handshake');
    expect(ids).not.toContain('icmp-ping');
  });

  it('offers ARP resolution only for IPv4 directly carried by Ethernet', () => {
    expect(
      applicableScenarios(stack(['ethernet', 'ipv4', 'tcp']), registry).map((s) => s.id),
    ).toContain('arp-resolution');
    expect(
      applicableScenarios(stack(['ipv4', 'tcp']), registry).map((s) => s.id),
    ).not.toContain('arp-resolution');
    expect(
      applicableScenarios(stack(['ethernet', 'vlan-8021q', 'ipv4']), registry).map(
        (s) => s.id,
      ),
    ).not.toContain('arp-resolution');
  });

  it('generates an ARP request/reply before the original IPv4 packet', () => {
    const original = stack(['ethernet', 'ipv4', 'tcp'], 'hello');
    original.layers[0]!.overrides.src = '02:00:00:00:00:0a';
    original.layers[0]!.overrides.dst = '02:00:00:00:00:0b';
    original.layers[1]!.overrides.src = '192.0.2.10';
    original.layers[1]!.overrides.dst = '192.0.2.11';

    const plans = byId('arp-resolution').generate(original, registry);
    expect(plans.map((p) => p.label)).toEqual(['ARP request', 'ARP reply', 'packet']);
    expect(plans.map((p) => p.atUsec)).toEqual([0, 15_000, 30_000]);

    const [request, reply, packet] = plans.map((p) => serializeStack(p.stack, registry));
    expect(request!.bytes).toHaveLength(42);
    expect(reply!.bytes).toHaveLength(42);
    expect([...request!.bytes.slice(0, 6)]).toEqual([255, 255, 255, 255, 255, 255]);
    expect([...request!.bytes.slice(12, 14)]).toEqual([0x08, 0x06]);
    expect([...request!.bytes.slice(20, 22)]).toEqual([0, 1]);
    expect([...reply!.bytes.slice(20, 22)]).toEqual([0, 2]);

    // The reply advertises the original destination as the owner of its IP.
    expect([...reply!.bytes.slice(22, 28)]).toEqual([...packet!.bytes.slice(0, 6)]);
    expect([...reply!.bytes.slice(28, 32)]).toEqual([...request!.bytes.slice(38, 42)]);
    expect([...reply!.bytes.slice(32, 38)]).toEqual([...request!.bytes.slice(22, 28)]);
    expect([...reply!.bytes.slice(38, 42)]).toEqual([...request!.bytes.slice(28, 32)]);

    expect(packet!.bytes).toEqual(serializeStack(original, registry).bytes);
    expect(plans[2]!.stack).toBe(original);
  });

  it('generates IPv6 Neighbor Solicitation/Advertisement before the packet', () => {
    const original = stack(['ethernet', 'ipv6', 'udp'], 'hello');
    original.layers[0]!.overrides.src = '02:00:00:00:00:0a';
    original.layers[0]!.overrides.dst = '02:00:00:00:00:0b';
    original.layers[1]!.overrides.src = '2001:db8::a';
    original.layers[1]!.overrides.dst = '2001:db8::1234:5678';

    const plans = byId('ndp-exchange').generate(original, registry);
    expect(plans.map((plan) => plan.label)).toEqual([
      'Neighbor Solicitation',
      'Neighbor Advertisement',
      'packet',
    ]);
    const [solicitation, advertisement, packet] = plans.map((plan) =>
      serializeStack(plan.stack, registry),
    );

    expect(solicitation!.bytes).toHaveLength(86);
    expect(advertisement!.bytes).toHaveLength(86);
    expect([...solicitation!.bytes.slice(0, 6)]).toEqual([0x33, 0x33, 0xff, 0x34, 0x56, 0x78]);
    expect([...solicitation!.bytes.slice(38, 54)]).toEqual([
      0xff, 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0xff, 0x34, 0x56, 0x78,
    ]);
    expect(solicitation!.bytes[54]).toBe(135);
    expect(solicitation!.bytes[78]).toBe(1);
    expect(solicitation!.bytes[79]).toBe(1);
    expect(advertisement!.bytes[54]).toBe(136);
    expect([...advertisement!.bytes.slice(58, 62)]).toEqual([0x60, 0, 0, 0]);
    expect(advertisement!.bytes[78]).toBe(2);
    expect(advertisement!.bytes[79]).toBe(1);
    expect(packet!.bytes).toEqual(serializeStack(original, registry).bytes);
    expect(solicitation!.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(advertisement!.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('generates a coherent TCP three-way handshake', () => {
    const plans = byId('tcp-handshake').generate(
      stack(['ethernet', 'ipv4', 'tcp'], 'GET / HTTP/1.1'),
      registry,
    );
    expect(plans.map((p) => p.label)).toEqual(['SYN', 'SYN-ACK', 'ACK']);

    const pkts = plans.map((p) => serializeStack(p.stack, registry));
    // handshake packets carry no payload
    for (const p of pkts) expect(p.bytes.length).toBe(14 + 20 + 20);

    const tcpAt = 34;
    const flags = pkts.map((p) => p.bytes[tcpAt + 13]!);
    expect(flags).toEqual([0x02, 0x12, 0x10]); // SYN, SYN|ACK, ACK

    // SYN-ACK flips MAC + IP + ports
    const syn = pkts[0]!.bytes;
    const synAck = pkts[1]!.bytes;
    expect([...synAck.slice(0, 6)]).toEqual([...syn.slice(6, 12)]); // dst = old src
    expect([...synAck.slice(26, 30)]).toEqual([...syn.slice(30, 34)]); // ipsrc = old dst
    expect([...synAck.slice(tcpAt, tcpAt + 2)]).toEqual([...syn.slice(tcpAt + 2, tcpAt + 4)]);

    // seq/ack arithmetic
    const u32 = (b: Uint8Array, o: number) =>
      ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
    const seq = u32(syn, tcpAt + 4);
    expect(u32(synAck, tcpAt + 8)).toBe(seq + 1); // SYN-ACK acks SYN+1
    expect(u32(pkts[2]!.bytes, tcpAt + 4)).toBe(seq + 1); // final ACK seq
  });

  it('offers a full TCP session only when TCP directly carries the payload', () => {
    expect(
      applicableScenarios(stack(['ethernet', 'ipv4', 'tcp']), registry).map((s) => s.id),
    ).toContain('tcp-session');
    expect(
      applicableScenarios(stack(['ethernet', 'ipv4', 'tcp', 'http1']), registry).map(
        (s) => s.id,
      ),
    ).not.toContain('tcp-session');
  });

  it('generates a full TCP session with coherent data and teardown arithmetic', () => {
    const clientData = 'hello';
    const plans = byId('tcp-session').generate(
      stack(['ethernet', 'ipv4', 'tcp'], clientData),
      registry,
    );
    expect(plans.map((p) => p.label)).toEqual([
      'SYN',
      'SYN-ACK',
      'ACK',
      'client data',
      'server data',
      'client FIN-ACK',
      'server FIN-ACK',
      'final ACK',
    ]);

    const packets = plans.map((plan) => serializeStack(plan.stack, registry));
    const tcpAt = 34;
    const u32 = (bytes: Uint8Array, offset: number) =>
      ((bytes[offset]! << 24) |
        (bytes[offset + 1]! << 16) |
        (bytes[offset + 2]! << 8) |
        bytes[offset + 3]!) >>>
      0;
    expect(packets.map((packet) => packet.bytes[tcpAt + 13])).toEqual([
      0x02, 0x12, 0x10, 0x18, 0x18, 0x11, 0x11, 0x10,
    ]);
    expect(packets.map((packet) => packet.bytes.length)).toEqual([
      54, 54, 54, 59, 65, 54, 54, 54,
    ]);

    const clientSeq = u32(packets[0]!.bytes, tcpAt + 4);
    const serverSeq = u32(packets[1]!.bytes, tcpAt + 4);
    const clientAfterData = clientSeq + 1 + clientData.length;
    const serverAfterData = serverSeq + 1 + 'server data'.length;
    expect(u32(packets[4]!.bytes, tcpAt + 8)).toBe(clientAfterData);
    expect(u32(packets[5]!.bytes, tcpAt + 4)).toBe(clientAfterData);
    expect(u32(packets[5]!.bytes, tcpAt + 8)).toBe(serverAfterData);
    expect(u32(packets[6]!.bytes, tcpAt + 8)).toBe(clientAfterData + 1);
    expect(u32(packets[7]!.bytes, tcpAt + 4)).toBe(clientAfterData + 1);
    expect(u32(packets[7]!.bytes, tcpAt + 8)).toBe(serverAfterData + 1);
    for (const packet of packets) {
      expect(packet.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    }
  });

  it('generates byte-valid TLS hello records over a coherent TCP session', () => {
    const plans = byId('tls-hello-exchange').generate(
      stack(['ethernet', 'ipv4', 'tcp', 'tls']),
      registry,
    );
    expect(plans.map((plan) => plan.label)).toEqual([
      'SYN',
      'SYN-ACK',
      'ACK',
      'ClientHello',
      'ServerHello',
      'client FIN-ACK',
      'server FIN-ACK',
      'final ACK',
    ]);

    const packets = plans.map((plan) => serializeStack(plan.stack, registry));
    const tcpAt = 34;
    const tlsAt = 54;
    const u16 = (bytes: Uint8Array, offset: number) =>
      (bytes[offset]! << 8) | bytes[offset + 1]!;
    const u32 = (bytes: Uint8Array, offset: number) =>
      ((bytes[offset]! << 24) |
        (bytes[offset + 1]! << 16) |
        (bytes[offset + 2]! << 8) |
        bytes[offset + 3]!) >>>
      0;

    expect(packets.map((packet) => packet.bytes.length)).toEqual([
      54, 54, 54, 106, 103, 54, 54, 54,
    ]);
    expect(packets[3]!.bytes[tlsAt]).toBe(22);
    expect(packets[3]!.bytes[tlsAt + 5]).toBe(1);
    expect(u16(packets[3]!.bytes, tlsAt + 3)).toBe(47);
    expect(packets[4]!.bytes[tlsAt]).toBe(22);
    expect(packets[4]!.bytes[tlsAt + 5]).toBe(2);
    expect(u16(packets[4]!.bytes, tlsAt + 3)).toBe(44);

    const clientSeq = u32(packets[0]!.bytes, tcpAt + 4);
    const serverSeq = u32(packets[1]!.bytes, tcpAt + 4);
    expect(u32(packets[4]!.bytes, tcpAt + 8)).toBe(clientSeq + 1 + 52);
    expect(u32(packets[5]!.bytes, tcpAt + 8)).toBe(serverSeq + 1 + 49);
    expect(u16(packets[0]!.bytes, tcpAt + 2)).toBe(443);
    expect(u16(packets[1]!.bytes, tcpAt)).toBe(443);
    for (const packet of packets) {
      expect(packet.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    }
  });

  it('generates an ICMP echo pair with flipped addresses', () => {
    const plans = byId('icmp-ping').generate(
      stack(['ethernet', 'ipv4', 'icmp'], 'abcdefgh'),
      registry,
    );
    const [req, rep] = plans.map((p) => serializeStack(p.stack, registry));
    expect(req!.bytes[34]).toBe(8); // echo request
    expect(rep!.bytes[34]).toBe(0); // echo reply
    expect([...rep!.bytes.slice(26, 30)]).toEqual([...req!.bytes.slice(30, 34)]);
    // both keep the payload
    expect(req!.bytes.length).toBe(rep!.bytes.length);
  });

  it('re-serializes each packet with fresh checksums', () => {
    const plans = byId('icmp-ping').generate(stack(['ethernet', 'ipv4', 'icmp']), registry);
    const [req, rep] = plans.map((p) => serializeStack(p.stack, registry));
    const ck = (b: Uint8Array) => (b[36]! << 8) | b[37]!;
    expect(ck(req!.bytes)).not.toBe(ck(rep!.bytes)); // type byte changed => checksum changed
    expect(req!.issues).toEqual([]);
    expect(rep!.issues).toEqual([]);
  });
});

describe('additional scenarios', () => {
  const errorsOf = (plan: { stack: StackInstance }) =>
    serializeStack(plan.stack, registry).issues.filter((i) => i.severity === 'error');

  it('offers TCP refusal whenever TCP is present, and generates SYN → RST-ACK', () => {
    expect(
      applicableScenarios(stack(['ethernet', 'ipv4', 'tcp', 'http1']), registry).map((s) => s.id),
    ).toContain('tcp-rst');

    const plans = byId('tcp-rst').generate(stack(['ethernet', 'ipv4', 'tcp']), registry);
    expect(plans.map((p) => p.label)).toEqual(['SYN', 'RST-ACK']);
    const [syn, rst] = plans.map((p) => serializeStack(p.stack, registry));
    const flagsAt = 34 + 13;
    expect(syn!.bytes[flagsAt]).toBe(0x02); // SYN
    expect(rst!.bytes[flagsAt]).toBe(0x14); // RST|ACK
    expect([...rst!.bytes.slice(0, 6)]).toEqual([...syn!.bytes.slice(6, 12)]); // flipped MACs
    plans.forEach((p) => expect(errorsOf(p)).toEqual([]));
  });

  it('offers ICMPv6 echo only for ICMPv6, and flips the addresses', () => {
    expect(
      applicableScenarios(stack(['ethernet', 'ipv4', 'icmp']), registry).map((s) => s.id),
    ).not.toContain('icmpv6-ping');

    const plans = byId('icmpv6-ping').generate(
      stack(['ethernet', 'ipv6', 'icmpv6'], 'abcdefgh'),
      registry,
    );
    expect(plans.map((p) => p.label)).toEqual(['echo request', 'echo reply']);
    const [req, rep] = plans.map((p) => serializeStack(p.stack, registry));
    expect(req!.bytes[54]).toBe(128); // echo request
    expect(rep!.bytes[54]).toBe(129); // echo reply
    expect([...rep!.bytes.slice(22, 38)]).toEqual([...req!.bytes.slice(38, 54)]); // IPv6 src/dst swap
    plans.forEach((p) => expect(errorsOf(p)).toEqual([]));
  });

  it('generates an NTP client poll and server reply with flipped modes', () => {
    const plans = byId('ntp-exchange').generate(
      stack(['ethernet', 'ipv4', 'udp', 'ntp']),
      registry,
    );
    expect(plans.map((p) => p.label)).toEqual(['client request', 'server response']);
    const [req, rep] = plans.map((p) => serializeStack(p.stack, registry));
    const ntpAt = 42;
    expect(req!.bytes[ntpAt]! & 0x07).toBe(3); // mode 3 = client
    expect(rep!.bytes[ntpAt]! & 0x07).toBe(4); // mode 4 = server
    expect(rep!.bytes[ntpAt + 1]).toBe(2); // server stratum
    expect(req!.bytes.slice(0, 6)).toEqual(rep!.bytes.slice(6, 12)); // flipped MACs
    plans.forEach((p) => expect(errorsOf(p)).toEqual([]));
  });

  it('generates the four-message DHCPv6 exchange', () => {
    const plans = byId('dhcpv6-exchange').generate(
      stack(['ethernet', 'ipv6', 'udp', 'dhcpv6']),
      registry,
    );
    expect(plans.map((p) => p.label)).toEqual(['SOLICIT', 'ADVERTISE', 'REQUEST', 'REPLY']);
    const msgTypeAt = 62;
    const packets = plans.map((p) => serializeStack(p.stack, registry));
    expect(packets.map((p) => p.bytes[msgTypeAt])).toEqual([1, 2, 3, 7]);
    plans.forEach((p) => expect(errorsOf(p)).toEqual([]));
  });
});
