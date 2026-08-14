import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import type { CapturePacket } from '../../../core/capture';
import ThroughputChart from './ThroughputChart';

function makePacket(num: number, relativeUsec: number, len = 64): CapturePacket {
  return {
    number: num,
    tsUsec: 1_000_000 + relativeUsec,
    relativeUsec,
    capturedLength: len,
    originalLength: len,
    snapped: false,
    bytes: new Uint8Array(len),
    status: 'exact',
    packet: null,
    stack: { layers: [] },
    protocols: ['TCP'],
    protocolIds: ['tcp'],
    topProtocol: 'TCP',
    source: '192.0.2.1',
    destination: '198.51.100.1',
    srcPort: 49152,
    dstPort: 80,
    summary: 'TCP Segment',
    notes: [],
    searchText: '',
  };
}

describe('ThroughputChart', () => {
  it('renders nothing when packet list is empty', () => {
    const html = renderToString(
      React.createElement(ThroughputChart, {
        packets: [],
        selectedRange: null,
        onSelectTimeRange: vi.fn(),
      }),
    );
    expect(html).toBe('');
  });

  it('renders throughput chart with metrics and SVG elements', () => {
    const packets = [
      makePacket(1, 0, 100),
      makePacket(2, 500_000, 200),
      makePacket(3, 1_000_000, 300),
    ];

    const html = renderToString(
      React.createElement(ThroughputChart, {
        packets,
        selectedRange: null,
        onSelectTimeRange: vi.fn(),
      }),
    );

    expect(html).toContain('Traffic Throughput');
    expect(html).toContain('Peak Rate');
    expect(html).toContain('Packets/sec');
    expect(html).toContain('Bytes/sec');
    expect(html).toContain('<svg');
  });

  it('displays active time window reset button when selectedRange is set', () => {
    const packets = [makePacket(1, 0), makePacket(2, 1_000_000)];

    const html = renderToString(
      React.createElement(ThroughputChart, {
        packets,
        selectedRange: { minUsec: 200_000, maxUsec: 800_000 },
        onSelectTimeRange: vi.fn(),
      }),
    );

    expect(html).toContain('Reset time filter');
  });
});
