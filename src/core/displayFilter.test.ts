import { describe, expect, it } from 'vitest';
import {
  getFilterAutocompletions,
  matchesDisplayFilter,
  parseDisplayFilter,
} from './displayFilter';
import type { CapturePacket } from './capture';

function mockPacket(overrides: Partial<CapturePacket> = {}): CapturePacket {
  return {
    number: 1,
    tsUsec: 1000,
    relativeUsec: 0,
    capturedLength: 64,
    originalLength: 64,
    snapped: false,
    bytes: new Uint8Array(64),
    status: 'exact',
    packet: {
      bytes: new Uint8Array(64),
      spans: [
        {
          layerUid: 'eth-1',
          fieldId: 'etherType',
          bitOffset: 96,
          bitLength: 16,
          value: 0x0800,
          computed: false,
          pinned: false,
        },
        {
          layerUid: 'ip-1',
          fieldId: 'protocol',
          bitOffset: 72,
          bitLength: 8,
          value: 6,
          computed: false,
          pinned: false,
        },
      ],
      layers: [],
      payloadOffset: 54,
      issues: [],
    },
    stack: { layers: [] },
    protocols: ['Ethernet', 'IPv4', 'TCP'],
    protocolIds: ['ethernet', 'ipv4', 'tcp'],
    topProtocol: 'TCP',
    source: '192.168.1.10',
    destination: '10.0.0.1',
    srcPort: 54321,
    dstPort: 80,
    summary: 'TCP 54321 -> 80 [SYN] Seq=0',
    notes: [],
    searchText: '00:11:22:33:44:55 192.168.1.10 10.0.0.1 54321 80 syn http',
    ...overrides,
  };
}

describe('parseDisplayFilter', () => {
  it('parses empty inputs', () => {
    expect(parseDisplayFilter('').ast).toBeNull();
    expect(parseDisplayFilter('   ').ast).toBeNull();
  });

  it('parses protocol names', () => {
    const res = parseDisplayFilter('tcp');
    expect(res.ast).toEqual({ kind: 'protocol', protocolId: 'tcp' });
    expect(res.isDisplayFilter).toBe(true);
    expect(res.error).toBeNull();
  });

  it('parses field comparison expressions', () => {
    const res = parseDisplayFilter('ip.src == "192.168.1.10"');
    expect(res.ast).toEqual({
      kind: 'fieldComparison',
      field: 'ip.src',
      op: '==',
      value: '192.168.1.10',
    });
    expect(res.isDisplayFilter).toBe(true);
    expect(res.error).toBeNull();
  });

  it('parses word-based comparison operators (eq, ne, gt, lt, ge, le)', () => {
    expect(parseDisplayFilter('tcp.port eq 80').ast).toMatchObject({ op: '==' });
    expect(parseDisplayFilter('tcp.port ne 80').ast).toMatchObject({ op: '!=' });
    expect(parseDisplayFilter('frame.len gt 50').ast).toMatchObject({ op: '>' });
    expect(parseDisplayFilter('frame.len lt 100').ast).toMatchObject({ op: '<' });
    expect(parseDisplayFilter('frame.len ge 64').ast).toMatchObject({ op: '>=' });
    expect(parseDisplayFilter('frame.len le 64').ast).toMatchObject({ op: '<=' });
  });

  it('parses parenthesized expressions and logical operators', () => {
    const res = parseDisplayFilter('(ip.src == 192.168.1.10 || ip.dst == 10.0.0.1) && !udp');
    expect(res.ast?.kind).toBe('logical');
  });

  it('reports syntax error for unterminated quotes and missing tokens', () => {
    expect(parseDisplayFilter('ip.src == "192.168.1.10').error).toContain('Unterminated string');
    expect(parseDisplayFilter('ip.src ==').error).toContain("Expected value after comparison operator '=='");
    expect(parseDisplayFilter('(ip.src == 192.168.1.10').error).toContain('Expected closing parenthesis');
  });
});

describe('matchesDisplayFilter', () => {
  const pkt = mockPacket();

  it('matches protocol filter', () => {
    expect(matchesDisplayFilter(pkt, parseDisplayFilter('tcp').ast!)).toBe(true);
    expect(matchesDisplayFilter(pkt, parseDisplayFilter('udp').ast!)).toBe(false);
  });

  it('matches text terms', () => {
    expect(matchesDisplayFilter(pkt, parseDisplayFilter('syn').ast!)).toBe(true);
  });

  it('matches IP and IPv6 address comparisons', () => {
    expect(matchesDisplayFilter(pkt, parseDisplayFilter('ip.src == 192.168.1.10').ast!)).toBe(true);
    expect(matchesDisplayFilter(pkt, parseDisplayFilter('ip.dst != 192.168.1.10').ast!)).toBe(true);
    expect(matchesDisplayFilter(pkt, parseDisplayFilter('ip.addr == 10.0.0.1').ast!)).toBe(true);

    const v6Pkt = mockPacket({ source: '2001:db8::1', destination: '2001:db8::2' });
    expect(matchesDisplayFilter(v6Pkt, parseDisplayFilter('ipv6.src == 2001:db8::1').ast!)).toBe(true);
    expect(matchesDisplayFilter(v6Pkt, parseDisplayFilter('ipv6.dst == 2001:db8::2').ast!)).toBe(true);
    expect(matchesDisplayFilter(v6Pkt, parseDisplayFilter('ipv6.addr == 2001:db8::1').ast!)).toBe(true);
  });

  it('matches MAC address, EtherType, and IP protocol comparisons', () => {
    expect(matchesDisplayFilter(pkt, parseDisplayFilter('eth.src == 00:11:22:33:44:55').ast!)).toBe(true);
    expect(matchesDisplayFilter(pkt, parseDisplayFilter('eth.type == 0x0800').ast!)).toBe(true);
    expect(matchesDisplayFilter(pkt, parseDisplayFilter('ip.proto == 6').ast!)).toBe(true);
  });

  it('matches port comparisons', () => {
    expect(matchesDisplayFilter(pkt, parseDisplayFilter('tcp.port == 80').ast!)).toBe(true);
    expect(matchesDisplayFilter(pkt, parseDisplayFilter('tcp.srcport == 54321').ast!)).toBe(true);
    expect(matchesDisplayFilter(pkt, parseDisplayFilter('tcp.dstport == 80').ast!)).toBe(true);
    expect(matchesDisplayFilter(pkt, parseDisplayFilter('udp.port == 53').ast!)).toBe(false);
  });

  it('matches frame length and number comparisons', () => {
    expect(matchesDisplayFilter(pkt, parseDisplayFilter('frame.len >= 64').ast!)).toBe(true);
    expect(matchesDisplayFilter(pkt, parseDisplayFilter('frame.number == 1').ast!)).toBe(true);
  });

  it('evaluates logical AND/OR/NOT correctly', () => {
    expect(matchesDisplayFilter(pkt, parseDisplayFilter('ip.src == 192.168.1.10 and tcp.port == 80').ast!)).toBe(true);
    expect(matchesDisplayFilter(pkt, parseDisplayFilter('ip.src == 1.1.1.1 or tcp.port == 80').ast!)).toBe(true);
    expect(matchesDisplayFilter(pkt, parseDisplayFilter('!udp').ast!)).toBe(true);
  });
});

describe('getFilterAutocompletions', () => {
  it('returns field suggestions for prefix', () => {
    const completions = getFilterAutocompletions('ip.');
    expect(completions.some((c) => c.completion === 'ip.src')).toBe(true);
    expect(completions.some((c) => c.completion === 'ip.dst')).toBe(true);
  });

  it('returns protocol suggestions for typed fragment and active capture', () => {
    const completions = getFilterAutocompletions('tc', [mockPacket()]);
    expect(completions.some((c) => c.completion === 'tcp')).toBe(true);
  });
});
