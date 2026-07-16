import { describe, expect, it } from 'vitest';
import { newLayer, type StackInstance } from './model';
import { serializeStack } from './serialize';
import { createBuiltinRegistry } from '../protocols';

const registry = createBuiltinRegistry();

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

/** Independent ones-complement sum, written differently from checksums.ts. */
function refOnesComplementSum(...chunks: Uint8Array[]): number {
  const all = chunks.flatMap((c) => [...c]);
  if (all.length % 2) all.push(0);
  let sum = 0;
  for (let i = 0; i < all.length; i += 2) {
    sum += all[i]! * 256 + all[i + 1]!;
    if (sum > 0xffff) sum -= 0xffff; // end-around carry
  }
  return sum;
}

function stack(protocolIds: string[], payload?: Uint8Array): StackInstance {
  return { layers: protocolIds.map(newLayer), trailingPayload: payload };
}

describe('serializeStack', () => {
  it('produces a byte-exact ICMP echo request (golden packet)', () => {
    const s = stack(['ethernet', 'ipv4', 'icmp'], new TextEncoder().encode('abcdefgh'));
    const result = serializeStack(s, registry);
    expect(result.issues).toEqual([]);
    expect(hex(result.bytes)).toBe(
      [
        '020000000002', // dst MAC
        '020000000001', // src MAC
        '0800', // EtherType = IPv4 (auto-bound)
        '4500', // version/IHL, DSCP/ECN
        '0024', // total length 36 (computed)
        '0001', // identification
        '4000', // DF
        '40', // TTL 64
        '01', // protocol = ICMP (auto-bound)
        '4ea2', // header checksum (hand-computed)
        'c0000201', // 192.0.2.1
        'c6336401', // 198.51.100.1
        '08', // ICMP type 8 echo request
        '00', // code
        '5435', // ICMP checksum (hand-computed)
        '1234', // identifier
        '0001', // sequence
        '6162636465666768', // "abcdefgh"
      ].join(''),
    );
  });

  it('IPv4 header checksum verifies to 0xffff with checksum in place', () => {
    const s = stack(['ethernet', 'ipv4', 'icmp']);
    const { bytes } = serializeStack(s, registry);
    const ipHeader = bytes.slice(14, 34);
    expect(refOnesComplementSum(ipHeader)).toBe(0xffff);
  });

  it('computes UDP length and a pseudo-header checksum that verifies', () => {
    const s = stack(['ethernet', 'ipv4', 'udp'], new TextEncoder().encode('hi'));
    const result = serializeStack(s, registry);
    expect(result.issues).toEqual([]);
    const { bytes } = result;
    const udpStart = 14 + 20;
    // Length field = 8 header + 2 payload
    expect((bytes[udpStart + 4]! << 8) | bytes[udpStart + 5]!).toBe(10);
    // IPv4 protocol auto-bound to 17
    expect(bytes[14 + 9]).toBe(17);
    // Pseudo-header + segment (checksum in place) sums to 0xffff
    const pseudo = Uint8Array.from([
      ...bytes.slice(14 + 12, 14 + 16), // src
      ...bytes.slice(14 + 16, 14 + 20), // dst
      0,
      17,
      0,
      10,
    ]);
    expect(refOnesComplementSum(pseudo, bytes.slice(udpStart))).toBe(0xffff);
  });

  it('chains EtherTypes through stacked VLAN tags (Q-in-Q)', () => {
    const s = stack(['ethernet', 'vlan-8021q', 'vlan-8021q', 'ipv4']);
    const { bytes } = serializeStack(s, registry);
    const u16 = (o: number) => (bytes[o]! << 8) | bytes[o + 1]!;
    expect(u16(12)).toBe(0x8100); // outer EtherType -> VLAN
    expect(u16(16)).toBe(0x8100); // first tag -> second VLAN
    expect(u16(20)).toBe(0x0800); // second tag -> IPv4
  });

  it('TCP checksum over pseudo-header verifies, dataOffset computed', () => {
    const s = stack(['ethernet', 'ipv4', 'tcp'], new TextEncoder().encode('GET'));
    const result = serializeStack(s, registry);
    expect(result.issues).toEqual([]);
    const { bytes } = result;
    const tcpStart = 34;
    expect(bytes[tcpStart + 12]! >> 4).toBe(5); // data offset, no options
    const segLen = bytes.length - tcpStart;
    const pseudo = Uint8Array.from([
      ...bytes.slice(26, 30),
      ...bytes.slice(30, 34),
      0,
      6,
      segLen >> 8,
      segLen & 0xff,
    ]);
    expect(refOnesComplementSum(pseudo, bytes.slice(tcpStart))).toBe(0xffff);
  });

  it('grows IHL and offsets when IPv4 options are set', () => {
    const s: StackInstance = { layers: [newLayer('ipv4'), newLayer('udp')] };
    s.layers[0]!.overrides['options'] = Uint8Array.from([1, 1, 1, 1]); // 4 NOPs
    const result = serializeStack(s, registry);
    expect(result.bytes[0]).toBe(0x46); // version 4, IHL 6
    const totalLength = (result.bytes[2]! << 8) | result.bytes[3]!;
    expect(totalLength).toBe(24 + 8);
    // UDP layer starts after the longer header
    expect(result.layers[1]!.byteOffset).toBe(24);
  });

  it('applies overrides and honours pinned computed fields with a warning', () => {
    const s = stack(['ethernet', 'ipv4']);
    s.layers[0]!.overrides['etherType'] = 0x86dd;
    s.layers[0]!.pinned = ['etherType'];
    const result = serializeStack(s, registry);
    expect((result.bytes[12]! << 8) | result.bytes[13]!).toBe(0x86dd);
    expect(result.issues.some((i) => i.severity === 'warning')).toBe(true);
  });

  it('exposes spans with correct absolute offsets', () => {
    const s = stack(['ethernet', 'ipv4']);
    const result = serializeStack(s, registry);
    const ttl = result.spans.find((sp) => sp.fieldId === 'ttl')!;
    expect(ttl.bitOffset).toBe((14 + 8) * 8);
    expect(ttl.bitLength).toBe(8);
    expect(ttl.value).toBe(64);
    const ihl = result.spans.find((sp) => sp.fieldId === 'ihl')!;
    expect(ihl.value).toBe(5);
    expect(ihl.computed).toBe(true);
  });
});
