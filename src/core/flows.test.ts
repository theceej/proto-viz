import { describe, expect, it } from 'vitest';
import type { CapturePacket } from './capture';
import { flowKey, flowLabel, groupFlows, packetsInFlow } from './flows';

let counter = 0;

/** A capture row carrying just the identity fields flows are built from. */
function packet(overrides: Partial<CapturePacket> = {}): CapturePacket {
  counter += 1;
  return {
    number: counter,
    tsUsec: 0,
    relativeUsec: 0,
    capturedLength: 100,
    originalLength: 100,
    snapped: false,
    bytes: new Uint8Array(0),
    status: 'exact',
    packet: null,
    stack: { layers: [] },
    protocols: ['Ethernet II', 'IPv4', 'TCP'],
    protocolIds: ['ethernet', 'ipv4', 'tcp'],
    topProtocol: 'TCP',
    source: '192.0.2.1',
    destination: '192.0.2.9',
    srcPort: 49152,
    dstPort: 80,
    summary: 'TCP',
    notes: [],
    searchText: '',
    ...overrides,
  };
}

const reversed = (overrides: Partial<CapturePacket> = {}) =>
  packet({
    source: '192.0.2.9',
    destination: '192.0.2.1',
    srcPort: 80,
    dstPort: 49152,
    ...overrides,
  });

describe('flowKey', () => {
  it('is identical for both directions of a conversation', () => {
    expect(flowKey(packet())).toBe(flowKey(reversed()));
  });

  it('separates conversations that differ only by port', () => {
    expect(flowKey(packet())).not.toBe(flowKey(packet({ dstPort: 443 })));
  });

  it('separates TCP from UDP between the same endpoints and ports', () => {
    const udp = packet({
      protocolIds: ['ethernet', 'ipv4', 'udp'],
      protocols: ['Ethernet II', 'IPv4', 'UDP'],
    });
    expect(flowKey(packet())).not.toBe(flowKey(udp));
  });

  it('groups portless packets by address pair alone', () => {
    const ping = packet({
      protocolIds: ['ethernet', 'ipv4', 'icmp'],
      srcPort: null,
      dstPort: null,
    });
    const pong = packet({
      protocolIds: ['ethernet', 'ipv4', 'icmp'],
      source: '192.0.2.9',
      destination: '192.0.2.1',
      srcPort: null,
      dstPort: null,
    });
    expect(flowKey(ping)).toBe(flowKey(pong));
  });

  it('orders two ports on the same address consistently', () => {
    const loopback = { source: '127.0.0.1', destination: '127.0.0.1' };
    expect(flowKey(packet({ ...loopback, srcPort: 5000, dstPort: 22 }))).toBe(
      flowKey(packet({ ...loopback, srcPort: 22, dstPort: 5000 })),
    );
  });

  it('falls back to an address-pair key when no transport layer is modeled', () => {
    // Ports without a recognised transport layer: the conversation is still
    // one conversation, just not attributable to TCP or UDP.
    const odd = packet({ protocolIds: ['ethernet', 'ipv4'], protocols: ['Ethernet II', 'IPv4'] });
    expect(flowKey(odd)).toContain('ip|');
  });

  it('is null when the packet has no readable addresses', () => {
    expect(flowKey(packet({ source: null, destination: null }))).toBeNull();
  });
});

describe('groupFlows', () => {
  it('folds both directions into one flow and totals it', () => {
    const flows = groupFlows([
      packet({ relativeUsec: 0, capturedLength: 74 }),
      reversed({ relativeUsec: 1_500, capturedLength: 74 }),
      packet({ relativeUsec: 3_000, capturedLength: 120 }),
    ]);

    expect(flows).toHaveLength(1);
    const flow = flows[0]!;
    expect(flow.packetCount).toBe(3);
    expect(flow.byteCount).toBe(268);
    expect(flow.firstUsec).toBe(0);
    expect(flow.lastUsec).toBe(3_000);
    expect(flow.durationUsec).toBe(3_000);
  });

  it('names the sender of the first packet as the initiator', () => {
    const [flow] = groupFlows([packet(), reversed()]);
    expect(flow!.initiator).toEqual({ address: '192.0.2.1', port: 49152 });
    expect(flow!.responder).toEqual({ address: '192.0.2.9', port: 80 });
    expect(flowLabel(flow!)).toBe('192.0.2.1:49152 ↔ 192.0.2.9:80');

    const [reverseFirst] = groupFlows([reversed(), packet()]);
    expect(reverseFirst!.initiator.address).toBe('192.0.2.9');
    // Both orderings still describe the same conversation.
    expect(reverseFirst!.key).toBe(flow!.key);
  });

  it('keeps separate conversations apart, in first-seen order', () => {
    const flows = groupFlows([
      packet({ destination: '192.0.2.9' }),
      packet({ destination: '203.0.113.5' }),
      reversed(),
    ]);
    expect(flows).toHaveLength(2);
    expect(flows[0]!.packetCount).toBe(2);
    expect(flows[1]!.packetCount).toBe(1);
  });

  it('collects the protocols seen anywhere in the flow', () => {
    const flows = groupFlows([
      packet(),
      reversed({
        protocols: ['Ethernet II', 'IPv4', 'TCP', 'TLS record'],
        protocolIds: ['ethernet', 'ipv4', 'tcp', 'tls'],
      }),
    ]);
    expect(flows[0]!.protocols).toEqual(['Ethernet II', 'IPv4', 'TCP', 'TLS record']);
  });

  it('omits packets that cannot be attributed to a conversation', () => {
    const flows = groupFlows([packet({ source: null, destination: null }), packet()]);
    expect(flows).toHaveLength(1);
    expect(flows[0]!.packetCount).toBe(1);
  });

  it('reports a single-packet flow as zero duration', () => {
    expect(groupFlows([packet({ relativeUsec: 42 })])[0]!.durationUsec).toBe(0);
  });

  it('labels a portless flow without port suffixes', () => {
    const [flow] = groupFlows([
      packet({ protocolIds: ['ethernet', 'ipv4', 'icmp'], srcPort: null, dstPort: null }),
    ]);
    expect(flowLabel(flow!)).toBe('192.0.2.1 ↔ 192.0.2.9');
  });
});

describe('packetsInFlow', () => {
  it('returns the packets of one flow in capture order', () => {
    const packets = [packet(), packet({ destination: '203.0.113.5' }), reversed()];
    const flows = groupFlows(packets);
    const first = packetsInFlow(packets, flows[0]!);

    expect(first.map((p) => p.number)).toEqual([packets[0]!.number, packets[2]!.number]);
  });
});
