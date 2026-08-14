import { describe, expect, it } from 'vitest';
import type { CapturePacket } from './capture';
import type { Flow } from './flows';
import {
  calculateThroughputBuckets,
  calculateProtocolDistribution,
  calculateStevensPlot,
  extractTcpDetails,
} from './captureAnalytics';

function makePacket(partial: Partial<CapturePacket> & { number: number; relativeUsec: number }): CapturePacket {
  return {
    number: partial.number,
    tsUsec: 1_000_000_000 + partial.relativeUsec,
    relativeUsec: partial.relativeUsec,
    capturedLength: partial.capturedLength ?? 64,
    originalLength: partial.originalLength ?? 64,
    snapped: false,
    bytes: new Uint8Array(partial.capturedLength ?? 64),
    status: 'exact',
    packet: partial.packet ?? null,
    stack: partial.stack ?? { layers: [] },
    protocols: partial.protocols ?? ['Ethernet II', 'IPv4', 'TCP'],
    protocolIds: partial.protocolIds ?? ['ethernet', 'ipv4', 'tcp'],
    topProtocol: partial.topProtocol ?? 'TCP',
    source: partial.source ?? '192.0.2.1',
    destination: partial.destination ?? '198.51.100.1',
    srcPort: partial.srcPort ?? 49152,
    dstPort: partial.dstPort ?? 80,
    summary: partial.summary ?? 'TCP segment',
    notes: [],
    searchText: '',
  };
}

describe('calculateThroughputBuckets', () => {
  it('returns zeroes for an empty packet list', () => {
    const res = calculateThroughputBuckets([]);
    expect(res.totalPackets).toBe(0);
    expect(res.totalBytes).toBe(0);
    expect(res.buckets).toHaveLength(0);
  });

  it('aggregates packets into buckets accurately with throughput rates', () => {
    const packets = [
      makePacket({ number: 1, relativeUsec: 0, capturedLength: 100 }),
      makePacket({ number: 2, relativeUsec: 500_000, capturedLength: 200 }),
      makePacket({ number: 3, relativeUsec: 1_000_000, capturedLength: 300 }),
    ];

    const res = calculateThroughputBuckets(packets, { bucketCount: 2 });
    expect(res.totalPackets).toBe(3);
    expect(res.totalBytes).toBe(600);
    expect(res.durationUsec).toBe(1_000_000);
    expect(res.buckets).toHaveLength(2);

    // Bucket 0 covers [0, 500_000)
    // Bucket 1 covers [500_000, 1_000_000]
    expect(res.buckets[0]!.packetCount).toBe(1);
    expect(res.buckets[0]!.byteCount).toBe(100);
    expect(res.buckets[1]!.packetCount).toBe(2);
    expect(res.buckets[1]!.byteCount).toBe(500);

    // Rate calculations
    expect(res.buckets[0]!.packetsPerSec).toBeCloseTo(2, 1);
    expect(res.buckets[1]!.packetsPerSec).toBeCloseTo(4, 1);
    expect(res.maxPacketsPerSec).toBeGreaterThan(0);
  });

  it('honours explicit minUsec and maxUsec bounds for filtering', () => {
    const packets = [
      makePacket({ number: 1, relativeUsec: 100, capturedLength: 50 }),
      makePacket({ number: 2, relativeUsec: 500, capturedLength: 50 }),
      makePacket({ number: 3, relativeUsec: 900, capturedLength: 50 }),
    ];

    const res = calculateThroughputBuckets(packets, {
      bucketCount: 5,
      minUsec: 400,
      maxUsec: 600,
    });

    expect(res.totalPackets).toBe(1);
    expect(res.firstUsec).toBe(400);
    expect(res.lastUsec).toBe(600);
  });
});

describe('calculateProtocolDistribution', () => {
  const packets = [
    makePacket({
      number: 1,
      relativeUsec: 0,
      capturedLength: 100,
      topProtocol: 'HTTP',
      protocols: ['Ethernet II', 'IPv4', 'TCP', 'HTTP'],
      protocolIds: ['ethernet', 'ipv4', 'tcp', 'http'],
    }),
    makePacket({
      number: 2,
      relativeUsec: 10,
      capturedLength: 200,
      topProtocol: 'DNS',
      protocols: ['Ethernet II', 'IPv4', 'UDP', 'DNS'],
      protocolIds: ['ethernet', 'ipv4', 'udp', 'dns'],
    }),
    makePacket({
      number: 3,
      relativeUsec: 20,
      capturedLength: 100,
      topProtocol: 'HTTP',
      protocols: ['Ethernet II', 'IPv4', 'TCP', 'HTTP'],
      protocolIds: ['ethernet', 'ipv4', 'tcp', 'http'],
    }),
  ];

  it('computes top-protocol breakdown by packet count and byte percentages', () => {
    const res = calculateProtocolDistribution(packets, 'top');
    expect(res.totalPackets).toBe(3);
    expect(res.totalBytes).toBe(400);
    expect(res.items).toHaveLength(2);

    const http = res.items.find((item) => item.name === 'HTTP');
    const dns = res.items.find((item) => item.name === 'DNS');

    expect(http?.packetCount).toBe(2);
    expect(http?.packetPercentage).toBeCloseTo(66.67, 1);
    expect(http?.byteCount).toBe(200);
    expect(http?.bytePercentage).toBe(50);

    expect(dns?.packetCount).toBe(1);
    expect(dns?.packetPercentage).toBeCloseTo(33.33, 1);
    expect(dns?.byteCount).toBe(200);
    expect(dns?.bytePercentage).toBe(50);
  });

  it('computes all-layer breakdown across encapsulated protocols', () => {
    const res = calculateProtocolDistribution(packets, 'all');
    expect(res.totalPackets).toBe(3);
    expect(res.items.some((item) => item.name === 'Ethernet II')).toBe(true);
    expect(res.items.some((item) => item.name === 'IPv4')).toBe(true);
    expect(res.items.some((item) => item.name === 'TCP')).toBe(true);
    expect(res.items.some((item) => item.name === 'UDP')).toBe(true);
  });
});

describe('calculateStevensPlot and extractTcpDetails', () => {
  it('extracts TCP details including sequence, ack, flags, and window', () => {
    const p = makePacket({
      number: 1,
      relativeUsec: 0,
      capturedLength: 74,
      stack: {
        layers: [
          {
            uid: 'l-tcp',
            protocolId: 'tcp',
            overrides: {
              seq: 1000,
              ack: 2000,
              flags: 0x12, // SYN + ACK
              window: 65535,
            },
            pinned: [],
          },
        ],
      },
    });

    const details = extractTcpDetails(p);
    expect(details).not.toBeNull();
    expect(details?.seq).toBe(1000);
    expect(details?.ack).toBe(2000);
    expect(details?.flags.syn).toBe(true);
    expect(details?.flags.ack).toBe(true);
    expect(details?.flags.fin).toBe(false);
    expect(details?.flagNames).toEqual(['SYN', 'ACK']);
  });

  it('calculates Stevens sequence numbers relative to ISN for a TCP flow', () => {
    const flow: Flow = {
      key: 'tcp|192.0.2.1:49152|198.51.100.1:80',
      initiator: { address: '192.0.2.1', port: 49152 },
      responder: { address: '198.51.100.1', port: 80 },
      protocols: ['TCP'],
      packetCount: 3,
      byteCount: 200,
      firstUsec: 0,
      lastUsec: 20_000,
      durationUsec: 20_000,
      packetNumbers: [1, 2, 3],
    };

    const packets = [
      // 1. SYN from Client
      makePacket({
        number: 1,
        relativeUsec: 0,
        source: '192.0.2.1',
        srcPort: 49152,
        destination: '198.51.100.1',
        dstPort: 80,
        stack: {
          layers: [
            {
              uid: 'l1',
              protocolId: 'tcp',
              overrides: { seq: 5000, flags: 0x02 }, // SYN
              pinned: [],
            },
          ],
        },
      }),
      // 2. SYN-ACK from Server
      makePacket({
        number: 2,
        relativeUsec: 10_000,
        source: '198.51.100.1',
        srcPort: 80,
        destination: '192.0.2.1',
        dstPort: 49152,
        stack: {
          layers: [
            {
              uid: 'l2',
              protocolId: 'tcp',
              overrides: { seq: 9000, ack: 5001, flags: 0x12 }, // SYN-ACK
              pinned: [],
            },
          ],
        },
      }),
      // 3. ACK + Data from Client
      makePacket({
        number: 3,
        relativeUsec: 20_000,
        capturedLength: 154,
        source: '192.0.2.1',
        srcPort: 49152,
        destination: '198.51.100.1',
        dstPort: 80,
        stack: {
          layers: [
            {
              uid: 'l3',
              protocolId: 'tcp',
              overrides: { seq: 5001, ack: 9001, flags: 0x18 }, // PSH-ACK
              pinned: [],
            },
          ],
        },
      }),
    ];

    const plot = calculateStevensPlot(packets, flow);
    expect(plot.hasData).toBe(true);
    expect(plot.points).toHaveLength(3);

    // Initial sequence numbers
    expect(plot.initialSeqForward).toBe(5000);
    expect(plot.initialSeqReverse).toBe(9000);

    // Packet 1 (Forward, SYN): relSeq = 0
    expect(plot.points[0]!.direction).toBe('forward');
    expect(plot.points[0]!.relSeq).toBe(0);

    // Packet 2 (Reverse, SYN-ACK): relSeq = 0, relAck = 1 (5001 - 5000)
    expect(plot.points[1]!.direction).toBe('reverse');
    expect(plot.points[1]!.relSeq).toBe(0);
    expect(plot.points[1]!.relAck).toBe(1);

    // Packet 3 (Forward, Data): relSeq = 1 (5001 - 5000), relAck = 1 (9001 - 9000)
    expect(plot.points[2]!.direction).toBe('forward');
    expect(plot.points[2]!.relSeq).toBe(1);
    expect(plot.points[2]!.relAck).toBe(1);
  });
});
