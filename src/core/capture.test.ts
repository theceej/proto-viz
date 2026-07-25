import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../protocols';
import { groupFlows } from './flows';
import { buildCapture, linkTypeName, UnsupportedLinkTypeError } from './capture';
import { newLayer, type FieldValue, type StackInstance } from './model';
import { LINKTYPE, writePcap } from './pcap';
import { readPcap } from './pcapRead';
import { serializeStack } from './serialize';

const registry = createBuiltinRegistry();

/** A stack of the given protocols, with per-layer field overrides applied. */
function stack(ids: string[], overrides: Record<string, FieldValue>[] = []): StackInstance {
  return {
    layers: ids.map((id, i) => ({ ...newLayer(id), overrides: overrides[i] ?? {} })),
  };
}

const bytesOf = (s: StackInstance) => serializeStack(s, registry).bytes;

/** Wrap packets in a pcap file and decode it, as the UI does. */
function capture(
  packets: { bytes: Uint8Array; tsSec: number; tsUsec: number }[],
  linkType: number = LINKTYPE.ETHERNET,
  fileName = 'test.pcap',
) {
  return buildCapture(readPcap(writePcap(packets, linkType)), registry, fileName);
}

describe('buildCapture', () => {
  it('decodes Ethernet packets and describes each one', () => {
    const tcp = stack(
      ['ethernet', 'ipv4', 'tcp'],
      [{}, { src: '192.0.2.1', dst: '192.0.2.9' }, { srcPort: 49152, dstPort: 80 }],
    );
    const result = capture([{ bytes: bytesOf(tcp), tsSec: 100, tsUsec: 0 }]);

    expect(result.linkType).toBe(LINKTYPE.ETHERNET);
    expect(result.linkTypeLabel).toBe('LINKTYPE_ETHERNET (1)');
    expect(result.packets).toHaveLength(1);

    const packet = result.packets[0]!;
    expect(packet.status).toBe('exact');
    expect(packet.protocolIds).toEqual(['ethernet', 'ipv4', 'tcp']);
    expect(packet.protocols).toEqual(['Ethernet II', 'IPv4', 'TCP']);
    expect(packet.topProtocol).toBe('TCP');
    expect(packet.source).toBe('192.0.2.1');
    expect(packet.destination).toBe('192.0.2.9');
    expect(packet.srcPort).toBe(49152);
    expect(packet.dstPort).toBe(80);
    expect(packet.summary).toContain('TCP');
    expect(packet.summary).toContain('49152 → 80');
    expect(packet.packet).not.toBeNull();
  });

  it('numbers packets and measures time relative to the first', () => {
    const bytes = bytesOf(stack(['ethernet', 'ipv4', 'udp']));
    const result = capture([
      { bytes, tsSec: 10, tsUsec: 0 },
      { bytes, tsSec: 10, tsUsec: 500 },
      { bytes, tsSec: 12, tsUsec: 0 },
    ]);

    expect(result.packets.map((p) => p.number)).toEqual([1, 2, 3]);
    expect(result.packets.map((p) => p.relativeUsec)).toEqual([0, 500, 2_000_000]);
  });

  it('reads raw-IP captures, choosing the version from the first nibble', () => {
    const v4 = bytesOf(stack(['ipv4', 'udp']));
    const v6 = bytesOf(stack(['ipv6', 'udp']));
    const result = capture(
      [
        { bytes: v4, tsSec: 1, tsUsec: 0 },
        { bytes: v6, tsSec: 1, tsUsec: 1 },
      ],
      LINKTYPE.RAW,
    );

    expect(result.packets[0]!.protocolIds[0]).toBe('ipv4');
    expect(result.packets[1]!.protocolIds[0]).toBe('ipv6');
  });

  it('starts at the version the IPv4 and IPv6 link types name', () => {
    const v4 = capture([{ bytes: bytesOf(stack(['ipv4', 'udp'])), tsSec: 1, tsUsec: 0 }], 228);
    const v6 = capture([{ bytes: bytesOf(stack(['ipv6', 'udp'])), tsSec: 1, tsUsec: 0 }], 229);

    expect(v4.linkTypeLabel).toBe('LINKTYPE_IPV4 (228)');
    expect(v4.packets[0]!.protocolIds).toEqual(['ipv4', 'udp']);
    expect(v6.linkTypeLabel).toBe('LINKTYPE_IPV6 (229)');
    expect(v6.packets[0]!.protocolIds).toEqual(['ipv6', 'udp']);
  });

  it('rejects link types it cannot start a decode from', () => {
    const bytes = bytesOf(stack(['ethernet']));
    expect(() => capture([{ bytes, tsSec: 1, tsUsec: 0 }], LINKTYPE.USER0)).toThrow(
      UnsupportedLinkTypeError,
    );
    expect(() => capture([{ bytes, tsSec: 1, tsUsec: 0 }], 113)).toThrow(/LINKTYPE_LINUX_SLL/);
  });

  it('keeps an undecodable record as a row with its bytes', () => {
    // A raw-IP record whose first nibble is neither 4 nor 6.
    const garbage = Uint8Array.from([0x99, 0x01, 0x02, 0x03]);
    const result = capture([{ bytes: garbage, tsSec: 1, tsUsec: 0 }], LINKTYPE.RAW);

    const packet = result.packets[0]!;
    expect(packet.status).toBe('failed');
    expect(packet.packet).toBeNull();
    expect([...packet.bytes]).toEqual([...garbage]);
    expect(packet.summary).toMatch(/not decoded/);
    expect(packet.notes[0]).toMatch(/link type does not identify/);
    expect(result.notes.join(' ')).toMatch(/1 of 1 packets could not be decoded/);
  });

  it('reports packets cut short by a snap length', () => {
    const full = bytesOf(stack(['ethernet', 'ipv4', 'udp']));
    const file = writePcap(
      [{ bytes: full.slice(0, 20), tsSec: 1, tsUsec: 0 }],
      LINKTYPE.ETHERNET,
    );
    // Claim the packet was longer on the wire than what was stored.
    new DataView(file.buffer).setUint32(24 + 12, full.length, true);

    const result = buildCapture(readPcap(file), registry, 'snapped.pcap');
    expect(result.packets[0]!.snapped).toBe(true);
    expect(result.packets[0]!.originalLength).toBe(full.length);
    expect(result.notes.join(' ')).toMatch(/cut short by the capture's snap length/);
  });

  it('carries the file-level notes from the reader through', () => {
    const bytes = bytesOf(stack(['ethernet', 'ipv4']));
    const file = writePcap([{ bytes, tsSec: 1, tsUsec: 0 }], LINKTYPE.ETHERNET);
    const result = buildCapture(readPcap(file.slice(0, file.length - 2)), registry, 'cut.pcap');

    expect(result.truncated).toBe(true);
    expect(result.notes.join(' ')).toMatch(/truncated/);
  });

  it('keeps a zero-length record as an undecodable row', () => {
    const result = capture([{ bytes: new Uint8Array(0), tsSec: 1, tsUsec: 0 }]);

    expect(result.packets[0]!.status).toBe('failed');
    expect(result.packets[0]!.notes[0]).toMatch(/no bytes/);
  });

  it('keeps a record whose first layer cannot be read at all', () => {
    // Two bytes is not enough for an Ethernet header, so no layer decodes.
    const result = capture([{ bytes: Uint8Array.from([0x00, 0x11]), tsSec: 1, tsUsec: 0 }]);

    const packet = result.packets[0]!;
    expect(packet.status).toBe('failed');
    expect(packet.packet).toBeNull();
    expect(packet.protocols).toEqual([]);
    expect(packet.topProtocol).toBe('—');
    expect(packet.notes.join(' ')).toMatch(/could not decode Ethernet II/);
  });

  it('indexes MAC and IPv6 addresses and active flag names for search', () => {
    const v6 = stack(
      ['ethernet', 'ipv6', 'tcp'],
      [{ src: '02:00:00:00:00:aa' }, { src: '2001:db8::1' }, { flags: 0x12 }],
    );
    const packet = capture([{ bytes: bytesOf(v6), tsSec: 1, tsUsec: 0 }]).packets[0]!;

    expect(packet.searchText).toContain('02:00:00:00:00:aa');
    expect(packet.searchText).toContain('2001:db8::1');
    // SYN+ACK: both set bits are named, not just the raw byte.
    expect(packet.searchText).toContain('syn');
    expect(packet.searchText).toContain('ack');
  });

  it('indexes field values and enum labels for free-text search', () => {
    const dns = stack(
      ['ethernet', 'ipv4', 'udp', 'dns'],
      [{}, { src: '198.51.100.7' }, { dstPort: 53 }, {}],
    );
    const packet = capture([{ bytes: bytesOf(dns), tsSec: 1, tsUsec: 0 }]).packets[0]!;

    expect(packet.searchText).toContain('dns');
    expect(packet.searchText).toContain('198.51.100.7');
    // The IPv4 Protocol field's enum label, not just its number.
    expect(packet.searchText).toContain('udp');
  });
});

describe('the sample capture fixture', () => {
  // Built byte-by-byte by scripts/make-capture-fixture.mjs, independently of
  // this codebase's serializer, and cross-checked with tshark.
  const file = new Uint8Array(readFileSync('fixtures/capture-handshake.pcap'));
  const result = buildCapture(readPcap(file), registry, 'capture-handshake.pcap');

  it('decodes every packet of a real classic pcap file exactly', () => {
    expect(result.packets).toHaveLength(5);
    expect(result.packets.every((p) => p.status === 'exact')).toBe(true);
    expect(result.notes).toEqual([]);
  });

  it('identifies the TCP handshake and the DNS exchange', () => {
    expect(result.packets.map((p) => p.topProtocol)).toEqual([
      'TCP',
      'TCP',
      'TCP',
      'DNS',
      'DNS',
    ]);
    expect(result.packets.map((p) => p.source)).toEqual([
      '192.0.2.10',
      '198.51.100.20',
      '192.0.2.10',
      '192.0.2.10',
      '198.51.100.53',
    ]);
    expect(result.packets.map((p) => p.relativeUsec)).toEqual([0, 420, 560, 2000, 14000]);
  });

  it('groups the file into two bidirectional conversations', () => {
    const flows = groupFlows(result.packets);
    expect(flows).toHaveLength(2);
    expect(flows[0]!.packetCount).toBe(3);
    expect(flows[0]!.durationUsec).toBe(560);
    expect(flows[1]!.packetCount).toBe(2);
    expect(flows[1]!.initiator).toEqual({ address: '192.0.2.10', port: 53000 });
  });
});

describe('linkTypeName', () => {
  it('names supported and recognised-but-unsupported link types', () => {
    expect(linkTypeName(LINKTYPE.ETHERNET)).toBe('LINKTYPE_ETHERNET (1)');
    expect(linkTypeName(LINKTYPE.RAW)).toBe('LINKTYPE_RAW (101)');
    expect(linkTypeName(113)).toBe('LINKTYPE_LINUX_SLL (113)');
    expect(linkTypeName(9999)).toBe('link type 9999');
  });
});
