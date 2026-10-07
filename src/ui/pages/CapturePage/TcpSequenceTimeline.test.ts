import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import type { CapturePacket } from '../../../core/capture';
import type { Flow } from '../../../core/flows';
import TcpSequenceTimeline from './TcpSequenceTimeline';

function makePacket(num: number, usec: number, overrides: Partial<CapturePacket> = {}): CapturePacket {
  return {
    number: num,
    tsUsec: 1_000_000 + usec,
    relativeUsec: usec,
    capturedLength: 74,
    originalLength: 74,
    snapped: false,
    bytes: new Uint8Array(74),
    status: 'exact',
    packet: null,
    stack: {
      layers: [
        {
          uid: `tcp-${num}`,
          protocolId: 'tcp',
          overrides: { seq: 1000 + num * 100, ack: 2000 + num * 100, flags: 0x18 },
          pinned: [],
        },
      ],
    },
    protocols: ['Ethernet II', 'IPv4', 'TCP'],
    protocolIds: ['ethernet', 'ipv4', 'tcp'],
    topProtocol: 'TCP',
    source: '192.0.2.1',
    destination: '198.51.100.1',
    srcPort: 49152,
    dstPort: 80,
    summary: 'TCP Segment',
    notes: [],
    searchText: '',
    ...overrides,
  };
}

describe('TcpSequenceTimeline', () => {
  it('renders a friendly notice when no TCP flows exist', () => {
    const html = renderToString(
      React.createElement(TcpSequenceTimeline, {
        packets: [],
        flows: [],
        selectedPacket: null,
        onSelectPacket: vi.fn(),
      }),
    );
    expect(html).toContain('No TCP Streams Found');
  });

  it('renders Stevens sequence plot for a TCP conversation', () => {
    const flow: Flow = {
      key: 'tcp|192.0.2.1:49152|198.51.100.1:80',
      initiator: { address: '192.0.2.1', port: 49152 },
      responder: { address: '198.51.100.1', port: 80 },
      protocols: ['TCP'],
      packetCount: 2,
      byteCount: 148,
      firstUsec: 0,
      lastUsec: 10_000,
      durationUsec: 10_000,
      packetNumbers: [1, 2],
    };

    const packets = [
      makePacket(1, 0),
      makePacket(2, 10_000, { source: '198.51.100.1', destination: '192.0.2.1', srcPort: 80, dstPort: 49152 }),
    ];

    const html = renderToString(
      React.createElement(TcpSequenceTimeline, {
        packets,
        flows: [flow],
        selectedPacket: 1,
        onSelectPacket: vi.fn(),
      }),
    );

    expect(html).toContain('TCP Stream Timeline');
    expect(html).toContain('192.0.2.1:49152');
    expect(html).toContain('198.51.100.1:80');
    expect(html).toContain('Relative Seq #');
    expect(html).toContain('<svg');
  });
});
