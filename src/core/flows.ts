/**
 * Grouping capture packets into bidirectional flows.
 *
 * A flow is one conversation, both directions together: a request and its
 * reply belong to the same row even though their addresses and ports are
 * swapped. That requires a key that is *stable under direction reversal*, so
 * the two endpoints are sorted into a canonical order before being joined —
 * `A:1234 ↔ B:80` and `B:80 ↔ A:1234` produce the same key, and whichever
 * endpoint sent the first packet is remembered separately as the initiator.
 *
 * Sorting is on the printable endpoint string with the port as a numeric
 * tiebreak, which is arbitrary but consistent — the only property the key
 * needs is that both directions land on it.
 */
import type { CapturePacket } from './capture';

export interface FlowEndpoint {
  address: string;
  port: number | null;
}

export interface Flow {
  /** Direction-independent identity, stable across reloads of the same file. */
  key: string;
  /** The endpoint that sent the flow's first packet. */
  initiator: FlowEndpoint;
  /** The other endpoint. */
  responder: FlowEndpoint;
  /** Protocol display names seen in this flow, outermost-first, deduplicated. */
  protocols: string[];
  packetCount: number;
  /** Total captured bytes across the flow. */
  byteCount: number;
  /** First and last capture time, microseconds since the first packet. */
  firstUsec: number;
  lastUsec: number;
  /** `lastUsec - firstUsec`; zero for a single-packet flow. */
  durationUsec: number;
  /** Packet numbers in the flow, in capture order. */
  packetNumbers: number[];
}

const endpointLabel = (endpoint: FlowEndpoint): string =>
  endpoint.port === null ? endpoint.address : `${endpoint.address}:${endpoint.port}`;

/** Human-readable flow identity, e.g. `192.0.2.1:49152 ↔ 192.0.2.2:80`. */
export function flowLabel(flow: Flow): string {
  return `${endpointLabel(flow.initiator)} ↔ ${endpointLabel(flow.responder)}`;
}

/**
 * The canonical key for the conversation a packet belongs to, or null when
 * it has no readable addresses (an undecodable record, say) and so cannot be
 * attributed to one.
 */
export function flowKey(packet: CapturePacket): string | null {
  const pair = endpointPair(packet);
  if (!pair) return null;
  const [a, b] = ordered(pair.from, pair.to);
  // The transport protocol is part of the identity: TCP and UDP traffic
  // between the same ports are different conversations.
  const transport = packet.srcPort === null ? 'ip' : transportId(packet);
  return `${transport}|${endpointLabel(a)}|${endpointLabel(b)}`;
}

function endpointPair(
  packet: CapturePacket,
): { from: FlowEndpoint; to: FlowEndpoint } | null {
  if (packet.source === null || packet.destination === null) return null;
  return {
    from: { address: packet.source, port: packet.srcPort },
    to: { address: packet.destination, port: packet.dstPort },
  };
}

/** Sort two endpoints into a fixed order so both directions agree. */
function ordered(a: FlowEndpoint, b: FlowEndpoint): [FlowEndpoint, FlowEndpoint] {
  if (a.address !== b.address) return a.address < b.address ? [a, b] : [b, a];
  return (a.port ?? -1) <= (b.port ?? -1) ? [a, b] : [b, a];
}

/** The innermost port-bearing protocol id, used to separate TCP from UDP. */
function transportId(packet: CapturePacket): string {
  for (const id of ['tcp', 'udp', 'sctp']) {
    if (packet.protocolIds.includes(id)) return id;
  }
  return 'ip';
}

/**
 * Group packets into flows, in first-seen order. Packets without readable
 * endpoints are not part of any flow and are simply absent from the result.
 */
export function groupFlows(packets: CapturePacket[]): Flow[] {
  const flows = new Map<string, Flow>();

  for (const packet of packets) {
    const key = flowKey(packet);
    const pair = endpointPair(packet);
    if (key === null || pair === null) continue;

    const existing = flows.get(key);
    if (!existing) {
      flows.set(key, {
        key,
        // First packet seen defines who initiated the conversation.
        initiator: pair.from,
        responder: pair.to,
        protocols: [...packet.protocols],
        packetCount: 1,
        byteCount: packet.capturedLength,
        firstUsec: packet.relativeUsec,
        lastUsec: packet.relativeUsec,
        durationUsec: 0,
        packetNumbers: [packet.number],
      });
      continue;
    }

    existing.packetCount += 1;
    existing.byteCount += packet.capturedLength;
    existing.firstUsec = Math.min(existing.firstUsec, packet.relativeUsec);
    existing.lastUsec = Math.max(existing.lastUsec, packet.relativeUsec);
    existing.durationUsec = existing.lastUsec - existing.firstUsec;
    existing.packetNumbers.push(packet.number);
    for (const protocol of packet.protocols) {
      if (!existing.protocols.includes(protocol)) existing.protocols.push(protocol);
    }
  }

  return [...flows.values()];
}

/** The packets belonging to one flow, in capture order. */
export function packetsInFlow(packets: CapturePacket[], flow: Flow): CapturePacket[] {
  const numbers = new Set(flow.packetNumbers);
  return packets.filter((packet) => numbers.has(packet.number));
}
