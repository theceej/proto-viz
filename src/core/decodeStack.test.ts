import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../protocols/index';
import { newLayer, type StackInstance } from './model';
import { serializeStack } from './serialize';
import { decodeStackBytes, parseHexInput, HexInputError } from './decodeStack';

const registry = createBuiltinRegistry();

/** Serialize a stack of protocol ids (with optional per-layer overrides). */
function bytesOf(
  ids: string[],
  payload?: Uint8Array,
  overrides: Record<number, Record<string, unknown>> = {},
  pins: Record<number, string[]> = {},
): Uint8Array {
  const stack: StackInstance = {
    layers: ids.map((id, i) => ({
      ...newLayer(id),
      overrides: (overrides[i] ?? {}) as Record<string, never>,
      pinned: pins[i] ?? [],
    })),
    trailingPayload: payload,
  };
  const packet = serializeStack(stack, registry);
  expect(packet.issues.filter((i) => i.severity === 'error')).toEqual([]);
  return packet.bytes;
}

const ids = (d: ReturnType<typeof decodeStackBytes>) => d.layers.map((l) => l.protocolId);

describe('parseHexInput', () => {
  it('accepts continuous, spaced, colon-, dash-, and 0x-separated hex', () => {
    const want = new Uint8Array([0x08, 0x00, 0x27, 0xab]);
    expect(parseHexInput('080027ab')).toEqual(want);
    expect(parseHexInput('08 00 27 AB')).toEqual(want);
    expect(parseHexInput('08:00:27:ab')).toEqual(want);
    expect(parseHexInput('08-00-27-ab')).toEqual(want);
    expect(parseHexInput('0x08 0x00 0x27 0xab')).toEqual(want);
    expect(parseHexInput('  08 00\n27 ab\t')).toEqual(want);
  });

  it('rejects empty input, odd digit counts, and non-hex characters', () => {
    expect(() => parseHexInput('')).toThrow(HexInputError);
    expect(() => parseHexInput('   ')).toThrow(HexInputError);
    expect(() => parseHexInput('08002')).toThrow(/odd number/);
    expect(() => parseHexInput('08 00 zz')).toThrow(/"z" is not a hex digit/);
  });
});

describe('decodeStackBytes', () => {
  it('round-trips Ethernet › IPv4 › TCP with payload, exactly', () => {
    const payload = new TextEncoder().encode('hello world');
    const input = bytesOf(['ethernet', 'ipv4', 'tcp'], payload, {
      1: { src: '192.0.2.99', ttl: 42 },
      2: { srcPort: 45000 },
    });
    const d = decodeStackBytes(input, registry, 'ethernet');
    expect(ids(d)).toEqual(['ethernet', 'ipv4', 'tcp']);
    expect(d.payload).toEqual(payload);
    expect(d.exact).toBe(true);
    expect(d.layers[1]!.overrides['src']).toBe('192.0.2.99');
    expect(d.layers[1]!.overrides['ttl']).toBe(42);
    expect(d.layers[2]!.overrides['srcPort']).toBe(45000);
    // No pins needed: computed fields reproduce from the wire values.
    expect(d.layers.flatMap((l) => l.pinned)).toEqual([]);
  });

  it('sizes TCP options from Data Offset and IPv4 options from IHL', () => {
    const tcpOpts = new Uint8Array([0x02, 0x04, 0x05, 0xb4]); // MSS 1460
    const ipOpts = new Uint8Array([0x01, 0x01, 0x01, 0x01]); // NOP padding
    const payload = new Uint8Array([1, 2, 3]);
    const input = bytesOf(['ethernet', 'ipv4', 'tcp'], payload, {
      1: { options: ipOpts },
      2: { options: tcpOpts },
    });
    const d = decodeStackBytes(input, registry, 'ethernet');
    expect(ids(d)).toEqual(['ethernet', 'ipv4', 'tcp']);
    expect(d.layers[1]!.overrides['options']).toEqual(ipOpts);
    expect(d.layers[2]!.overrides['options']).toEqual(tcpOpts);
    expect(d.payload).toEqual(payload);
    expect(d.exact).toBe(true);
  });

  it('follows re-provided namespaces (Q-in-Q) and opaque VXLAN carriage', () => {
    const qinq = decodeStackBytes(
      bytesOf(['ethernet', 'vlan-8021q', 'vlan-8021q', 'ipv4', 'udp']),
      registry,
      'ethernet',
    );
    expect(ids(qinq)).toEqual(['ethernet', 'vlan-8021q', 'vlan-8021q', 'ipv4', 'udp']);
    expect(qinq.exact).toBe(true);

    const overlay = ['ethernet', 'ipv4', 'udp', 'vxlan', 'ethernet', 'ipv4', 'udp'];
    const vxlan = decodeStackBytes(
      bytesOf(overlay, new TextEncoder().encode('inner')),
      registry,
      'ethernet',
    );
    expect(ids(vxlan)).toEqual(overlay);
    expect(vxlan.exact).toBe(true);
  });

  it('decodes DNS: self-delimiting name, remainder as records', () => {
    const records = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const input = bytesOf(['ethernet', 'ipv4', 'udp', 'dns'], undefined, {
      3: { qname: 'www.example.org', ancount: 1, records },
    });
    const d = decodeStackBytes(input, registry, 'ethernet');
    expect(ids(d)).toEqual(['ethernet', 'ipv4', 'udp', 'dns']);
    expect(d.layers[3]!.overrides['qname']).toBe('www.example.org');
    expect(d.layers[3]!.overrides['records']).toEqual(records);
    expect(d.exact).toBe(true);
  });

  it('identifies a DNS response by its source port', () => {
    // dstPort is a computed binding field; pinning it makes this a response
    // (source port 53, ephemeral destination) instead of a query.
    const input = bytesOf(
      ['ethernet', 'ipv4', 'udp', 'dns'],
      undefined,
      { 2: { srcPort: 53, dstPort: 51044 }, 3: { qr: 1 } },
      { 2: ['dstPort'] },
    );
    const d = decodeStackBytes(input, registry, 'ethernet');
    expect(ids(d)).toEqual(['ethernet', 'ipv4', 'udp', 'dns']);
    expect(d.notes.some((n) => n.includes('source port 53'))).toBe(true);
    expect(d.exact).toBe(true);
  });

  it('preserves a wrong checksum by pinning it', () => {
    const input = bytesOf(['ethernet', 'ipv4', 'udp'], new Uint8Array([9, 9]));
    // Corrupt the IPv4 header checksum (bytes 24-25 of the frame).
    const corrupt = input.slice();
    corrupt[24]! ^= 0xff;
    const d = decodeStackBytes(corrupt, registry, 'ethernet');
    expect(ids(d)).toEqual(['ethernet', 'ipv4', 'udp']);
    expect(d.layers[1]!.pinned).toContain('headerChecksum');
    expect(d.exact).toBe(true);
  });

  it('pins an EtherType nothing in the library claims', () => {
    const input = parseHexInput(
      '02 00 00 00 00 01' + '02 00 00 00 00 02' + '99 99' + 'ca fe',
    );
    const d = decodeStackBytes(input, registry, 'ethernet');
    expect(ids(d)).toEqual(['ethernet']);
    expect(d.layers[0]!.pinned).toContain('etherType');
    expect(d.payload).toEqual(new Uint8Array([0xca, 0xfe]));
    expect(d.notes.some((n) => n.includes('claims'))).toBe(true);
    expect(d.exact).toBe(true);
  });

  it('stops at opaque content with several possible claimants (TLS, ICMP)', () => {
    const tls = decodeStackBytes(
      bytesOf(['ethernet', 'ipv4', 'tcp', 'tls'], new TextEncoder().encode('secret')),
      registry,
      'ethernet',
    );
    expect(ids(tls)).toEqual(['ethernet', 'ipv4', 'tcp', 'tls']);
    expect(tls.notes.some((n) => n.includes('opaquely'))).toBe(true);
    expect(tls.exact).toBe(true);

    const icmp = decodeStackBytes(
      bytesOf(['ethernet', 'ipv4', 'icmp'], new TextEncoder().encode('abcdefgh')),
      registry,
      'ethernet',
    );
    expect(ids(icmp)).toEqual(['ethernet', 'ipv4', 'icmp']);
    expect(icmp.exact).toBe(true);
  });

  it('keeps undecodable text-protocol content as payload with a note', () => {
    const input = bytesOf(['ethernet', 'ipv4', 'tcp', 'http1']);
    const d = decodeStackBytes(input, registry, 'ethernet');
    expect(ids(d)).toEqual(['ethernet', 'ipv4', 'tcp']);
    expect(d.notes.some((n) => n.includes('HTTP'))).toBe(true);
    expect(d.exact).toBe(true); // headers + raw payload reproduce the bytes
  });

  it('handles truncated input gracefully', () => {
    const full = bytesOf(['ethernet', 'ipv4', 'tcp']);
    const d = decodeStackBytes(full.slice(0, 20), registry, 'ethernet'); // cut mid-IPv4
    expect(ids(d)).toEqual(['ethernet']);
    expect(d.notes.some((n) => n.includes('truncated'))).toBe(true);
    expect(d.payload.length).toBe(20 - 14);
  });

  it('decodes from a non-Ethernet start protocol', () => {
    const input = bytesOf(['ipv4', 'udp'], new Uint8Array([1, 2, 3]));
    const d = decodeStackBytes(input, registry, 'ipv4');
    expect(ids(d)).toEqual(['ipv4', 'udp']);
    expect(d.exact).toBe(true);
  });

  it('round-trips every registry protocol that serializes losslessly', () => {
    // Not all protocols are wire-identifiable (text protocols, opaque
    // carriers) — but for stacks the decoder *does* fully identify, the
    // result must reproduce the input exactly.
    const input = bytesOf(['ethernet', 'ipv6', 'udp'], new Uint8Array([7]));
    const d = decodeStackBytes(input, registry, 'ethernet');
    expect(ids(d)).toEqual(['ethernet', 'ipv6', 'udp']);
    expect(d.exact).toBe(true);
  });
});
