/**
 * Pure calculation engine for Capture Viewer analytics.
 *
 * Provides decoupled, deterministic data structures for:
 * 1. Time-series throughput calculation (packets/sec and bytes/sec bucketing).
 * 2. Protocol volume and byte distribution breakdown (top layer or all layers).
 * 3. TCP stream analysis and Stevens-style sequence number vs time plotting.
 */
import type { CapturePacket } from './capture';
import type { Flow } from './flows';
import { packetsInFlow } from './flows';

export interface ThroughputBucket {
  index: number;
  startUsec: number;
  endUsec: number;
  midUsec: number;
  packetCount: number;
  byteCount: number;
  packetsPerSec: number;
  bytesPerSec: number;
  /** Primary protocol in this time bucket */
  dominantProtocol: string | null;
}

export interface ThroughputSummary {
  totalPackets: number;
  totalBytes: number;
  durationUsec: number;
  firstUsec: number;
  lastUsec: number;
  bucketDurationUsec: number;
  maxPacketsPerSec: number;
  maxBytesPerSec: number;
  avgPacketsPerSec: number;
  avgBytesPerSec: number;
  buckets: ThroughputBucket[];
}

export const DEFAULT_BUCKET_COUNT = 60;

/**
 * Groups packets into time buckets and computes packet rate (pkts/s) and
 * byte throughput (bytes/s) across the capture timeline.
 */
export function calculateThroughputBuckets(
  packets: CapturePacket[],
  options?: {
    bucketCount?: number;
    minUsec?: number;
    maxUsec?: number;
  },
): ThroughputSummary {
  if (packets.length === 0) {
    return {
      totalPackets: 0,
      totalBytes: 0,
      durationUsec: 0,
      firstUsec: 0,
      lastUsec: 0,
      bucketDurationUsec: 0,
      maxPacketsPerSec: 0,
      maxBytesPerSec: 0,
      avgPacketsPerSec: 0,
      avgBytesPerSec: 0,
      buckets: [],
    };
  }

  const rawFirst = packets.reduce((min, p) => Math.min(min, p.relativeUsec), Infinity);
  const rawLast = packets.reduce((max, p) => Math.max(max, p.relativeUsec), -Infinity);

  const firstUsec = options?.minUsec !== undefined ? options.minUsec : rawFirst;
  const lastUsec = options?.maxUsec !== undefined ? options.maxUsec : rawLast;
  const durationUsec = Math.max(1, lastUsec - firstUsec);

  const bucketCount = Math.max(1, Math.min(options?.bucketCount ?? DEFAULT_BUCKET_COUNT, 300));
  const bucketDurationUsec = durationUsec / bucketCount;
  const bucketDurationSec = Math.max(0.000001, bucketDurationUsec / 1_000_000);

  const buckets: ThroughputBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    index: i,
    startUsec: firstUsec + i * bucketDurationUsec,
    endUsec: firstUsec + (i + 1) * bucketDurationUsec,
    midUsec: firstUsec + (i + 0.5) * bucketDurationUsec,
    packetCount: 0,
    byteCount: 0,
    packetsPerSec: 0,
    bytesPerSec: 0,
    dominantProtocol: null,
  }));

  const bucketProtocolCounts = Array.from({ length: bucketCount }, () => new Map<string, number>());

  let totalBytes = 0;
  let inWindowPackets = 0;

  for (const packet of packets) {
    if (packet.relativeUsec < firstUsec || packet.relativeUsec > lastUsec) continue;

    inWindowPackets += 1;
    totalBytes += packet.capturedLength;

    const rawIndex = Math.floor((packet.relativeUsec - firstUsec) / bucketDurationUsec);
    const bucketIndex = Math.min(bucketCount - 1, Math.max(0, rawIndex));
    const bucket = buckets[bucketIndex]!;

    bucket.packetCount += 1;
    bucket.byteCount += packet.capturedLength;

    const protoMap = bucketProtocolCounts[bucketIndex]!;
    const count = protoMap.get(packet.topProtocol) ?? 0;
    protoMap.set(packet.topProtocol, count + 1);
  }

  let maxPacketsPerSec = 0;
  let maxBytesPerSec = 0;

  for (let i = 0; i < bucketCount; i++) {
    const bucket = buckets[i]!;
    bucket.packetsPerSec = bucket.packetCount / bucketDurationSec;
    bucket.bytesPerSec = bucket.byteCount / bucketDurationSec;

    if (bucket.packetsPerSec > maxPacketsPerSec) maxPacketsPerSec = bucket.packetsPerSec;
    if (bucket.bytesPerSec > maxBytesPerSec) maxBytesPerSec = bucket.bytesPerSec;

    // Dominant protocol
    let dominant: string | null = null;
    let maxProtoCount = 0;
    for (const [proto, count] of bucketProtocolCounts[i]!.entries()) {
      if (count > maxProtoCount) {
        maxProtoCount = count;
        dominant = proto;
      }
    }
    bucket.dominantProtocol = dominant;
  }

  const durationSec = Math.max(0.000001, durationUsec / 1_000_000);
  const avgPacketsPerSec = inWindowPackets / durationSec;
  const avgBytesPerSec = totalBytes / durationSec;

  return {
    totalPackets: inWindowPackets,
    totalBytes,
    durationUsec,
    firstUsec,
    lastUsec,
    bucketDurationUsec,
    maxPacketsPerSec,
    maxBytesPerSec,
    avgPacketsPerSec,
    avgBytesPerSec,
    buckets,
  };
}

export interface ProtocolShare {
  protocolId: string;
  name: string;
  packetCount: number;
  packetPercentage: number;
  byteCount: number;
  bytePercentage: number;
  colorIndex: number;
}

export interface ProtocolDistribution {
  totalPackets: number;
  totalBytes: number;
  items: ProtocolShare[];
}

/**
 * Calculates distribution of packet volume and byte percentages by protocol.
 * - 'top': Breakdown by innermost decoded protocol (e.g. DNS, HTTP, TCP).
 * - 'all': Breakdown across all encapsulated protocol layers (e.g. Ethernet, IPv4, TCP).
 */
export function calculateProtocolDistribution(
  packets: CapturePacket[],
  mode: 'top' | 'all' = 'top',
): ProtocolDistribution {
  if (packets.length === 0) {
    return { totalPackets: 0, totalBytes: 0, items: [] };
  }

  const totalPackets = packets.length;
  const totalBytes = packets.reduce((sum, p) => sum + p.capturedLength, 0);

  const stats = new Map<string, { name: string; packetCount: number; byteCount: number }>();

  if (mode === 'top') {
    for (const packet of packets) {
      const id = packet.protocolIds[packet.protocolIds.length - 1] ?? packet.topProtocol.toLowerCase();
      const name = packet.topProtocol;
      const existing = stats.get(id);
      if (existing) {
        existing.packetCount += 1;
        existing.byteCount += packet.capturedLength;
      } else {
        stats.set(id, { name, packetCount: 1, byteCount: packet.capturedLength });
      }
    }
  } else {
    for (const packet of packets) {
      packet.protocolIds.forEach((id, idx) => {
        const name = packet.protocols[idx] ?? id;
        const existing = stats.get(id);
        if (existing) {
          existing.packetCount += 1;
          existing.byteCount += packet.capturedLength;
        } else {
          stats.set(id, { name, packetCount: 1, byteCount: packet.capturedLength });
        }
      });
    }
  }

  const sorted = [...stats.entries()].sort((a, b) => b[1].byteCount - a[1].byteCount);

  const items: ProtocolShare[] = sorted.map(([protocolId, entry], index) => ({
    protocolId,
    name: entry.name,
    packetCount: entry.packetCount,
    packetPercentage: totalPackets > 0 ? (entry.packetCount / totalPackets) * 100 : 0,
    byteCount: entry.byteCount,
    bytePercentage: totalBytes > 0 ? (entry.byteCount / totalBytes) * 100 : 0,
    colorIndex: index,
  }));

  return { totalPackets, totalBytes, items };
}

export interface TcpPacketPoint {
  packetNumber: number;
  relativeUsec: number;
  direction: 'forward' | 'reverse';
  seq: number;
  relSeq: number;
  ack: number | null;
  relAck: number | null;
  payloadLength: number;
  flags: {
    syn: boolean;
    ack: boolean;
    fin: boolean;
    rst: boolean;
    psh: boolean;
    urg: boolean;
  };
  flagNames: string[];
  window: number;
  summary: string;
}

export interface StevensPlotData {
  flowKey: string;
  initiatorAddress: string;
  responderAddress: string;
  firstUsec: number;
  lastUsec: number;
  durationUsec: number;
  initialSeqForward: number;
  initialSeqReverse: number;
  maxSeqForward: number;
  maxSeqReverse: number;
  maxAckForward: number;
  maxAckReverse: number;
  points: TcpPacketPoint[];
  hasData: boolean;
}

/**
 * Extracts TCP header fields (seq, ack, flags, window, payloadLength) from a packet.
 */
export function extractTcpDetails(packet: CapturePacket): {
  seq: number;
  ack: number | null;
  flagsNum: number;
  window: number;
  payloadLength: number;
  flags: {
    syn: boolean;
    ack: boolean;
    fin: boolean;
    rst: boolean;
    psh: boolean;
    urg: boolean;
  };
  flagNames: string[];
} | null {
  const tcpLayer = packet.stack.layers.find((l) => l.protocolId === 'tcp');
  if (!tcpLayer) return null;

  const overrides = tcpLayer.overrides;
  const seq = typeof overrides.seq === 'number' ? overrides.seq : Number(overrides.seq ?? 0);
  const flagsNum = typeof overrides.flags === 'number' ? overrides.flags : Number(overrides.flags ?? 0);
  const hasAck = (flagsNum & 0x10) !== 0;
  const ack = hasAck
    ? (typeof overrides.ack === 'number' ? overrides.ack : Number(overrides.ack ?? 0))
    : null;
  const window = typeof overrides.window === 'number' ? overrides.window : Number(overrides.window ?? 65535);

  const flags = {
    cwr: (flagsNum & 0x80) !== 0,
    ece: (flagsNum & 0x40) !== 0,
    urg: (flagsNum & 0x20) !== 0,
    ack: hasAck,
    psh: (flagsNum & 0x08) !== 0,
    rst: (flagsNum & 0x04) !== 0,
    syn: (flagsNum & 0x02) !== 0,
    fin: (flagsNum & 0x01) !== 0,
  };

  const flagNames: string[] = [];
  if (flags.syn) flagNames.push('SYN');
  if (flags.ack) flagNames.push('ACK');
  if (flags.fin) flagNames.push('FIN');
  if (flags.rst) flagNames.push('RST');
  if (flags.psh) flagNames.push('PSH');
  if (flags.urg) flagNames.push('URG');

  // Estimate or calculate TCP payload length
  let payloadLength = 0;
  if (packet.packet) {
    const tcpLayout = packet.packet.layers.find((l) => l.protocolId === 'tcp');
    if (tcpLayout) {
      const tcpEnd = tcpLayout.byteOffset + tcpLayout.headerBytes;
      payloadLength = Math.max(0, packet.capturedLength - tcpEnd);
    }
  } else {
    // If not serialized, dataOffset in 32-bit words (default 5 words = 20 bytes)
    const dataOffsetWords = typeof overrides.dataOffset === 'number' ? overrides.dataOffset : 5;
    const tcpHeaderBytes = dataOffsetWords * 4;
    // Typical IPv4 header is 20 bytes, Ethernet 14 bytes
    const estimatedHeaders = 14 + 20 + tcpHeaderBytes;
    payloadLength = Math.max(0, packet.capturedLength - estimatedHeaders);
  }

  return {
    seq,
    ack,
    flagsNum,
    window,
    payloadLength,
    flags,
    flagNames,
  };
}

/**
 * Calculates Stevens sequence-number vs time plot data for a given TCP flow.
 */
export function calculateStevensPlot(
  allPackets: CapturePacket[],
  flow: Flow,
): StevensPlotData {
  const flowPackets = packetsInFlow(allPackets, flow);
  const initiatorAddr = flow.initiator.port !== null ? `${flow.initiator.address}:${flow.initiator.port}` : flow.initiator.address;
  const responderAddr = flow.responder.port !== null ? `${flow.responder.address}:${flow.responder.port}` : flow.responder.address;

  let initialSeqForward: number | null = null;
  let initialSeqReverse: number | null = null;
  let maxSeqForward = 0;
  let maxSeqReverse = 0;
  let maxAckForward = 0;
  let maxAckReverse = 0;

  const points: TcpPacketPoint[] = [];

  for (const packet of flowPackets) {
    const tcp = extractTcpDetails(packet);
    if (!tcp) continue;

    const packetSrc = packet.srcPort !== null ? `${packet.source}:${packet.srcPort}` : (packet.source ?? '');
    const isForward = packetSrc === initiatorAddr || packet.source === flow.initiator.address;
    const direction: 'forward' | 'reverse' = isForward ? 'forward' : 'reverse';

    if (direction === 'forward') {
      if (initialSeqForward === null) initialSeqForward = tcp.seq;
    } else {
      if (initialSeqReverse === null) initialSeqReverse = tcp.seq;
    }

    const isnSelf = direction === 'forward' ? (initialSeqForward ?? tcp.seq) : (initialSeqReverse ?? tcp.seq);
    const isnPeer = direction === 'forward' ? (initialSeqReverse ?? 0) : (initialSeqForward ?? 0);

    // Compute relative sequence number (32-bit wrapping safe for reasonable captures)
    const relSeq = (tcp.seq - isnSelf + 0x100000000) % 0x100000000;
    const relAck = tcp.ack !== null && isnPeer !== null
      ? (tcp.ack - isnPeer + 0x100000000) % 0x100000000
      : null;

    const effectiveLength = tcp.flags.syn || tcp.flags.fin ? Math.max(1, tcp.payloadLength) : tcp.payloadLength;
    const seqEnd = relSeq + effectiveLength;

    if (direction === 'forward') {
      if (seqEnd > maxSeqForward) maxSeqForward = seqEnd;
      if (relAck !== null && relAck > maxAckForward) maxAckForward = relAck;
    } else {
      if (seqEnd > maxSeqReverse) maxSeqReverse = seqEnd;
      if (relAck !== null && relAck > maxAckReverse) maxAckReverse = relAck;
    }

    points.push({
      packetNumber: packet.number,
      relativeUsec: packet.relativeUsec,
      direction,
      seq: tcp.seq,
      relSeq,
      ack: tcp.ack,
      relAck,
      payloadLength: tcp.payloadLength,
      flags: tcp.flags,
      flagNames: tcp.flagNames,
      window: tcp.window,
      summary: packet.summary,
    });
  }

  const firstUsec = points.length > 0 ? points[0]!.relativeUsec : 0;
  const lastUsec = points.length > 0 ? points[points.length - 1]!.relativeUsec : 0;

  return {
    flowKey: flow.key,
    initiatorAddress: initiatorAddr,
    responderAddress: responderAddr,
    firstUsec,
    lastUsec,
    durationUsec: Math.max(0, lastUsec - firstUsec),
    initialSeqForward: initialSeqForward ?? 0,
    initialSeqReverse: initialSeqReverse ?? 0,
    maxSeqForward,
    maxSeqReverse,
    maxAckForward,
    maxAckReverse,
    points,
    hasData: points.length > 0,
  };
}
