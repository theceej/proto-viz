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
    packet: null,
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
    searchText: '192.168.1.10 10.0.0.1 54321 80 syn http',
    ...overrides,
  };
}

describe('parseDisplayFilter', () => {
  it('parses protocol names', () => {
    const res = parseDisplayFilter('tcp');
    expect(res.ast).toEqual({ kind: 'protocol', protocolId: 'tcp' });
    expect(res.isDisplayFilter).toBe(true);
    expect(res.error).toBeNull();
  });

  it('parses field comparison expressions', () => {
    const res = parseDisplayFilter('ip.src == 192.168.1.10');
    expect(res.ast).toEqual({
      kind: 'fieldComparison',
      field: 'ip.src',
      op: '==',
      value: '192.168.1.10',
    });
    expect(res.isDisplayFilter).toBe(true);
    expect(res.error).toBeNull();
  });

  it('parses comparison operators and numbers', () => {
    const res = parseDisplayFilter('tcp.port == 80');
    expect(res.ast).toEqual({
      kind: 'fieldComparison',
      field: 'tcp.port',
      op: '==',
      value: '80',
    });
  });

  it('parses logical AND / OR / NOT expressions', () => {
    const res = parseDisplayFilter('ip.src == 192.168.1.10 && tcp.port == 80');
    expect(res.ast?.kind).toBe('logical');
    if (res.ast?.kind === 'logical') {
      expect(res.ast.op).toBe('and');
    }
  });

  it('reports syntax error for incomplete expressions', () => {
    const res = parseDisplayFilter('ip.src ==');
    expect(res.error).toContain("Expected value after comparison operator '=='");
  });
});

describe('matchesDisplayFilter', () => {
  const pkt = mockPacket();

  it('matches protocol filter', () => {
    const res = parseDisplayFilter('tcp');
    expect(matchesDisplayFilter(pkt, res.ast!)).toBe(true);

    const udpRes = parseDisplayFilter('udp');
    expect(matchesDisplayFilter(pkt, udpRes.ast!)).toBe(false);
  });

  it('matches IP address comparisons', () => {
    const srcRes = parseDisplayFilter('ip.src == 192.168.1.10');
    expect(matchesDisplayFilter(pkt, srcRes.ast!)).toBe(true);

    const dstRes = parseDisplayFilter('ip.dst == 10.0.0.1');
    expect(matchesDisplayFilter(pkt, dstRes.ast!)).toBe(true);

    const addrRes = parseDisplayFilter('ip.addr == 10.0.0.1');
    expect(matchesDisplayFilter(pkt, addrRes.ast!)).toBe(true);

    const wrongRes = parseDisplayFilter('ip.src == 172.16.0.1');
    expect(matchesDisplayFilter(pkt, wrongRes.ast!)).toBe(false);
  });

  it('matches port comparisons', () => {
    const portRes = parseDisplayFilter('tcp.port == 80');
    expect(matchesDisplayFilter(pkt, portRes.ast!)).toBe(true);

    const srcPortRes = parseDisplayFilter('tcp.srcport == 54321');
    expect(matchesDisplayFilter(pkt, srcPortRes.ast!)).toBe(true);

    const wrongPortRes = parseDisplayFilter('tcp.dstport == 443');
    expect(matchesDisplayFilter(pkt, wrongPortRes.ast!)).toBe(false);
  });

  it('matches frame length comparisons', () => {
    const lenRes = parseDisplayFilter('frame.len >= 64');
    expect(matchesDisplayFilter(pkt, lenRes.ast!)).toBe(true);

    const smallRes = parseDisplayFilter('frame.len > 100');
    expect(matchesDisplayFilter(pkt, smallRes.ast!)).toBe(false);
  });

  it('evaluates logical AND/OR/NOT correctly', () => {
    const andMatch = parseDisplayFilter('ip.src == 192.168.1.10 and tcp.port == 80');
    expect(matchesDisplayFilter(pkt, andMatch.ast!)).toBe(true);

    const notMatch = parseDisplayFilter('not udp');
    expect(matchesDisplayFilter(pkt, notMatch.ast!)).toBe(true);
  });
});

describe('getFilterAutocompletions', () => {
  it('returns field suggestions for prefix', () => {
    const completions = getFilterAutocompletions('ip.');
    expect(completions.some((c) => c.completion === 'ip.src')).toBe(true);
    expect(completions.some((c) => c.completion === 'ip.dst')).toBe(true);
  });

  it('returns protocol suggestions for typed fragment', () => {
    const completions = getFilterAutocompletions('tc');
    expect(completions.some((c) => c.completion === 'tcp')).toBe(true);
  });
});
