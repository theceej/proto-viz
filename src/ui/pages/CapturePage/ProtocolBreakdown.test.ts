import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import type { CapturePacket } from '../../../core/capture';
import ProtocolBreakdown from './ProtocolBreakdown';

function makePacket(num: number, topProtocol: string, protocols: string[], protocolIds: string[], bytes = 100): CapturePacket {
  return {
    number: num,
    tsUsec: 1_000_000 + num * 1000,
    relativeUsec: num * 1000,
    capturedLength: bytes,
    originalLength: bytes,
    snapped: false,
    bytes: new Uint8Array(bytes),
    status: 'exact',
    packet: null,
    stack: { layers: [] },
    protocols,
    protocolIds,
    topProtocol,
    source: '192.0.2.1',
    destination: '198.51.100.1',
    srcPort: 49152,
    dstPort: 80,
    summary: `${topProtocol} packet`,
    notes: [],
    searchText: '',
  };
}

describe('ProtocolBreakdown', () => {
  it('renders nothing for empty packets', () => {
    const html = renderToString(
      React.createElement(ProtocolBreakdown, {
        packets: [],
        selectedProtocolId: null,
        onSelectProtocol: vi.fn(),
      }),
    );
    expect(html).toBe('');
  });

  it('renders protocol distribution with donut chart and comparative list', () => {
    const packets = [
      makePacket(1, 'HTTP', ['Ethernet II', 'IPv4', 'TCP', 'HTTP'], ['ethernet', 'ipv4', 'tcp', 'http'], 300),
      makePacket(2, 'DNS', ['Ethernet II', 'IPv4', 'UDP', 'DNS'], ['ethernet', 'ipv4', 'udp', 'dns'], 100),
    ];

    const html = renderToString(
      React.createElement(ProtocolBreakdown, {
        packets,
        selectedProtocolId: null,
        onSelectProtocol: vi.fn(),
      }),
    );

    expect(html).toContain('Protocol Breakdown');
    expect(html).toContain('HTTP');
    expect(html).toContain('DNS');
    expect(html).toContain('By Bytes');
    expect(html).toContain('By Packets');
    expect(html).toContain('<svg');
  });
});
