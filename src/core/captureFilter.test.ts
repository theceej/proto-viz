import { describe, expect, it } from 'vitest';
import type { CapturePacket, DecodeStatus } from './capture';
import {
  EMPTY_FILTER,
  filterPackets,
  isEmptyFilter,
  matchesFilter,
  protocolOptions,
  type CaptureFilter,
} from './captureFilter';

/** A capture row with only the fields filtering looks at. */
function packet(overrides: Partial<CapturePacket> = {}): CapturePacket {
  return {
    number: 1,
    tsUsec: 0,
    relativeUsec: 0,
    capturedLength: 74,
    originalLength: 74,
    snapped: false,
    bytes: new Uint8Array(0),
    status: 'exact' as DecodeStatus,
    packet: null,
    stack: { layers: [] },
    protocols: ['Ethernet II', 'IPv4', 'TCP'],
    protocolIds: ['ethernet', 'ipv4', 'tcp'],
    topProtocol: 'TCP',
    source: '192.0.2.1',
    destination: '192.0.2.9',
    srcPort: 49152,
    dstPort: 80,
    summary: 'TCP · 49152 → 80',
    notes: [],
    searchText: 'ethernet ii ipv4 tcp syn 192.0.2.1 192.0.2.9',
    ...overrides,
  };
}

const filter = (overrides: Partial<CaptureFilter>): CaptureFilter => ({
  ...EMPTY_FILTER,
  ...overrides,
});

describe('isEmptyFilter', () => {
  it('treats the empty filter and whitespace-only text as unset', () => {
    expect(isEmptyFilter(EMPTY_FILTER)).toBe(true);
    expect(isEmptyFilter(filter({ text: '   ' }))).toBe(true);
    expect(isEmptyFilter(filter({ port: 80 }))).toBe(false);
    expect(isEmptyFilter(filter({ minLength: 0 }))).toBe(false);
  });
});

describe('matchesFilter', () => {
  it('matches everything when nothing is set', () => {
    expect(matchesFilter(packet(), EMPTY_FILTER)).toBe(true);
  });

  it('requires every free-text term, in summary or field values', () => {
    expect(matchesFilter(packet(), filter({ text: 'syn' }))).toBe(true);
    expect(matchesFilter(packet(), filter({ text: 'TCP 49152' }))).toBe(true);
    expect(matchesFilter(packet(), filter({ text: 'tcp udp' }))).toBe(false);
    expect(matchesFilter(packet(), filter({ text: 'nothing-here' }))).toBe(false);
  });

  it('matches a protocol at any depth of the stack', () => {
    expect(matchesFilter(packet(), filter({ protocolId: 'ipv4' }))).toBe(true);
    expect(matchesFilter(packet(), filter({ protocolId: 'tcp' }))).toBe(true);
    expect(matchesFilter(packet(), filter({ protocolId: 'udp' }))).toBe(false);
  });

  it('matches an address prefix against either direction', () => {
    expect(matchesFilter(packet(), filter({ address: '192.0.2.9' }))).toBe(true);
    expect(matchesFilter(packet(), filter({ address: '192.0.2.' }))).toBe(true);
    expect(matchesFilter(packet(), filter({ address: '203.0.113.5' }))).toBe(false);
    expect(matchesFilter(packet({ source: null, destination: null }), filter({ address: '192' }))).toBe(
      false,
    );
  });

  it('matches a port against either direction', () => {
    expect(matchesFilter(packet(), filter({ port: 80 }))).toBe(true);
    expect(matchesFilter(packet(), filter({ port: 49152 }))).toBe(true);
    expect(matchesFilter(packet(), filter({ port: 443 }))).toBe(false);
  });

  it('bounds the captured length inclusively', () => {
    expect(matchesFilter(packet(), filter({ minLength: 74, maxLength: 74 }))).toBe(true);
    expect(matchesFilter(packet(), filter({ minLength: 75 }))).toBe(false);
    expect(matchesFilter(packet(), filter({ maxLength: 73 }))).toBe(false);
  });

  it('selects by decode status', () => {
    expect(matchesFilter(packet(), filter({ status: 'exact' }))).toBe(true);
    expect(matchesFilter(packet(), filter({ status: 'failed' }))).toBe(false);
    expect(matchesFilter(packet({ status: 'failed' }), filter({ status: 'failed' }))).toBe(true);
  });

  it('ANDs independent criteria together', () => {
    expect(matchesFilter(packet(), filter({ protocolId: 'tcp', port: 80 }))).toBe(true);
    expect(matchesFilter(packet(), filter({ protocolId: 'tcp', port: 443 }))).toBe(false);
  });
});

describe('filterPackets', () => {
  const packets = [
    packet({ number: 1 }),
    packet({ number: 2, dstPort: 443, summary: 'TLS', protocolIds: ['ethernet', 'ipv4', 'tcp', 'tls'] }),
    packet({ number: 3, status: 'failed', protocolIds: [], source: null, destination: null }),
  ];

  it('returns the same array when the filter is empty', () => {
    expect(filterPackets(packets, EMPTY_FILTER)).toBe(packets);
  });

  it('keeps capture order in the filtered result', () => {
    expect(filterPackets(packets, filter({ protocolId: 'tcp' })).map((p) => p.number)).toEqual([
      1, 2,
    ]);
  });
});

describe('protocolOptions', () => {
  it('counts protocols and orders them outermost-first', () => {
    const options = protocolOptions([
      packet(),
      packet({
        protocols: ['Ethernet II', 'IPv4', 'UDP'],
        protocolIds: ['ethernet', 'ipv4', 'udp'],
      }),
    ]);

    expect(options.map((o) => o.id)).toEqual(['ethernet', 'ipv4', 'tcp', 'udp']);
    expect(options.find((o) => o.id === 'ethernet')?.count).toBe(2);
    expect(options.find((o) => o.id === 'tcp')?.count).toBe(1);
    expect(options.find((o) => o.id === 'ipv4')?.name).toBe('IPv4');
  });
});
