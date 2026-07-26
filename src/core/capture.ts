/**
 * Turning a parsed capture file into something inspectable: each record is
 * run through the same `decodeStackBytes` walk the hex-paste decoder uses,
 * then re-serialized so the capture viewer's field/diagram/hex panes see
 * exactly the packet shape the rest of the app already knows how to render.
 *
 * Decoding is best-effort by design. A capture is other people's traffic —
 * it will contain protocols the library does not model, packets cut short by
 * a snap length, and bytes that are simply garbage. Every record therefore
 * produces a row: one that decoded exactly, one that decoded as far as it
 * could, or one that did not decode at all but still shows its timestamp,
 * length, and raw bytes.
 *
 * The container format (classic pcap or pcapng) is resolved here and then
 * forgotten: `openCaptureFile` sniffs the magic, routes to a parser, and
 * everything downstream works from the format-independent `ReadCapture`.
 */
import { decodeStackBytes, type DecodedStack } from './decodeStack';
import { newLayer, type FieldValue, type StackInstance } from './model';
import { packetEndpoints, packetPorts } from './packetIdentity';
import {
  DEFAULT_LIMITS,
  type CaptureReadLimits,
  type CaptureRecord,
  type ReadCapture,
} from './captureFile';
import { readPcap } from './pcapRead';
import { readPcapng } from './pcapngRead';
import { BLOCK } from './pcapng';
import type { Registry } from './registry';
import { serializeStack, type SerializedPacket } from './serialize';
import { formatHexBytes, formatIPv4, formatIPv6, formatMac } from './values';
import { LINKTYPE } from './pcap';

/** Link types this reader can hand to the decoder, and where decoding starts. */
const LINK_TYPE_NAMES: Record<number, string> = {
  [LINKTYPE.ETHERNET]: 'LINKTYPE_ETHERNET',
  [LINKTYPE.RAW]: 'LINKTYPE_RAW',
  228: 'LINKTYPE_IPV4',
  229: 'LINKTYPE_IPV6',
};

/** Recognised but not decodable — named so rejections can say what they saw. */
const UNSUPPORTED_LINK_TYPE_NAMES: Record<number, string> = {
  0: 'LINKTYPE_NULL',
  113: 'LINKTYPE_LINUX_SLL',
  [LINKTYPE.USER0]: 'LINKTYPE_USER0',
  276: 'LINKTYPE_LINUX_SLL2',
};

export function linkTypeName(linkType: number): string {
  const name = LINK_TYPE_NAMES[linkType] ?? UNSUPPORTED_LINK_TYPE_NAMES[linkType];
  return name ? `${name} (${linkType})` : `link type ${linkType}`;
}

export class UnsupportedLinkTypeError extends Error {}

/**
 * The protocol a packet's outermost header is, for a given link type.
 * `LINKTYPE_RAW` carries bare IP with no indication of which version, so the
 * first nibble — the IP version field, in both v4 and v6 — decides.
 */
function startProtocolId(linkType: number, bytes: Uint8Array): string | null {
  switch (linkType) {
    case LINKTYPE.ETHERNET:
      return 'ethernet';
    case 228:
      return 'ipv4';
    case 229:
      return 'ipv6';
    case LINKTYPE.RAW: {
      const version = (bytes[0] ?? 0) >> 4;
      if (version === 4) return 'ipv4';
      if (version === 6) return 'ipv6';
      return null;
    }
    default:
      return null;
  }
}

const isSupportedLinkType = (linkType: number): boolean => linkType in LINK_TYPE_NAMES;

/** Why one link type cannot be decoded, phrased for the person holding the file. */
function unsupportedLinkTypeReason(linkType: number): string {
  const suffix =
    linkType === LINKTYPE.USER0
      ? ' — proto-viz writes this for non-Ethernet link layers, but the file itself does not say which one.'
      : '';
  return `${linkTypeName(linkType)} is not supported${suffix} Supported: Ethernet (1), raw IP (101), IPv4 (228), IPv6 (229).`;
}

/**
 * Reject a capture only when *nothing* in it can be decoded. pcapng files may
 * describe several interfaces, and one unsupported interface is no reason to
 * refuse the packets from the others — those become undecodable rows instead,
 * each saying which link type it was.
 */
function assertAnySupportedLinkType(records: CaptureRecord[], fileLinkType: number): void {
  const present = new Set(records.map((record) => record.linkType));
  if (present.size === 0) present.add(fileLinkType);
  if ([...present].some(isSupportedLinkType)) return;

  const reasons = [...present].map(unsupportedLinkTypeReason);
  throw new UnsupportedLinkTypeError(reasons[0]!);
}

export type DecodeStatus = 'exact' | 'partial' | 'failed';

export interface CapturePacket {
  /** 1-based file position, matching capture tools' packet numbering. */
  number: number;
  /** Absolute capture time in microseconds since the Unix epoch. */
  tsUsec: number;
  /** Microseconds since the first packet in the capture. */
  relativeUsec: number;
  /** Bytes present in the file (`incl_len`). */
  capturedLength: number;
  /** Length on the wire (`orig_len`); larger when a snap length applied. */
  originalLength: number;
  /** True when the capture stored fewer bytes than the packet had. */
  snapped: boolean;
  bytes: Uint8Array;
  status: DecodeStatus;
  /** Serialized form driving the inspection panes; null when decoding failed. */
  packet: SerializedPacket | null;
  /** The stack the panes render, in the decoder's reconstructed form. */
  stack: StackInstance;
  /** Display names of the decoded layers, outermost first. */
  protocols: string[];
  /** Protocol ids of the decoded layers, outermost first. */
  protocolIds: string[];
  /** Innermost decoded protocol's display name, or "—". */
  topProtocol: string;
  source: string | null;
  destination: string | null;
  srcPort: number | null;
  dstPort: number | null;
  /** One-line description, in the spirit of a capture tool's info column. */
  summary: string;
  /** The file's own note about this packet (pcapng `opt_comment`). */
  comment?: string;
  /** Why a decode stopped early, straight from the decoder. */
  notes: string[];
  /** Lowercased haystack for free-text filtering: summary plus field values. */
  searchText: string;
}

export interface Capture {
  fileName: string;
  format: ReadCapture['format'];
  linkType: number;
  linkTypeLabel: string;
  timestampPrecision: ReadCapture['timestampPrecision'];
  byteOrder: ReadCapture['byteOrder'];
  snapLength: number;
  packets: CapturePacket[];
  /** File-level observations from the reader plus any decoding caveats. */
  notes: string[];
  truncated: boolean;
  capped: boolean;
}

/**
 * Read a capture file of either supported container format. Throws
 * `CaptureReadError` for a file that cannot be parsed at all.
 */
export function readCaptureBytes(
  data: Uint8Array,
  limits: CaptureReadLimits = DEFAULT_LIMITS,
): ReadCapture {
  // pcapng announces itself with a Section Header Block; a classic pcap
  // magic number cannot collide with it, so four bytes decide the parser.
  const isPcapng =
    data.length >= 4 &&
    new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, false) ===
      BLOCK.SECTION_HEADER;
  return isPcapng ? readPcapng(data, limits) : readPcap(data, limits);
}

/** Read and decode a capture file in one step — the capture viewer's entry point. */
export function openCaptureFile(
  data: Uint8Array,
  registry: Registry,
  fileName: string,
  limits: CaptureReadLimits = DEFAULT_LIMITS,
  onProgress?: (processed: number, total: number) => void,
): Capture {
  return buildCapture(readCaptureBytes(data, limits), registry, fileName, onProgress);
}

/** Decode every record of a parsed capture. Throws on an unsupported link type. */
export function buildCapture(
  read: ReadCapture,
  registry: Registry,
  fileName: string,
  onProgress?: (processed: number, total: number) => void,
): Capture {
  assertAnySupportedLinkType(read.records, read.linkType);
  const baseUsec = read.records[0]?.tsUsec ?? 0;
  const total = read.records.length;
  const packets: CapturePacket[] = [];

  for (let i = 0; i < total; i++) {
    packets.push(buildPacket(read.records[i]!, registry, baseUsec));
    if (onProgress && ((i + 1) % 50 === 0 || i === total - 1)) {
      onProgress(i + 1, total);
    }
  }

  const notes = [...read.notes];
  const failed = packets.filter((p) => p.status === 'failed').length;
  if (failed > 0) {
    notes.push(
      `${failed} of ${packets.length} packets could not be decoded; their bytes are still shown.`,
    );
  }
  const snapped = packets.filter((p) => p.snapped).length;
  if (snapped > 0) {
    notes.push(
      `${snapped} packets were cut short by the capture's snap length (${read.snapLength} bytes), so their tails are missing.`,
    );
  }

  return {
    fileName,
    format: read.format,
    linkType: read.linkType,
    linkTypeLabel: linkTypeName(read.linkType),
    timestampPrecision: read.timestampPrecision,
    byteOrder: read.byteOrder,
    snapLength: read.snapLength,
    packets,
    notes,
    truncated: read.truncated,
    capped: read.capped,
  };
}

function buildPacket(
  record: CaptureRecord,
  registry: Registry,
  baseUsec: number,
): CapturePacket {
  const common = {
    number: record.number,
    tsUsec: record.tsUsec,
    relativeUsec: record.tsUsec - baseUsec,
    capturedLength: record.bytes.length,
    originalLength: record.originalLength,
    snapped: record.originalLength > record.bytes.length,
    bytes: record.bytes,
    ...(record.comment !== undefined ? { comment: record.comment } : {}),
  };

  const startId = startProtocolId(record.linkType, record.bytes);
  const undecodable = (why: string): CapturePacket => ({
    ...common,
    status: 'failed',
    packet: null,
    stack: { layers: [], trailingPayload: record.bytes },
    protocols: [],
    protocolIds: [],
    topProtocol: '—',
    source: null,
    destination: null,
    srcPort: null,
    dstPort: null,
    summary: `${record.bytes.length} bytes, not decoded`,
    notes: [why],
    searchText: 'not decoded',
  });

  if (record.bytes.length === 0) return undecodable('the record contains no bytes');
  if (!isSupportedLinkType(record.linkType)) {
    return undecodable(unsupportedLinkTypeReason(record.linkType));
  }
  if (startId === null) {
    return undecodable(
      `the link type does not identify the first protocol (first byte 0x${(record.bytes[0] ?? 0).toString(16).padStart(2, '0')})`,
    );
  }

  let decoded: DecodedStack;
  try {
    decoded = decodeStackBytes(record.bytes, registry, startId);
  } catch (e) {
    return undecodable((e as Error).message);
  }
  if (decoded.layers.length === 0) {
    return undecodable(decoded.notes[0] ?? 'no layer could be read');
  }

  const stack: StackInstance = {
    layers: decoded.layers.map((layer) => ({
      ...newLayer(layer.protocolId),
      overrides: layer.overrides,
      pinned: layer.pinned,
    })),
    trailingPayload: decoded.payload,
  };

  let packet: SerializedPacket | null = null;
  const notes = [...decoded.notes];
  try {
    packet = serializeStack(stack, registry);
  } catch (e) {
    notes.push(`re-serializing the decoded stack failed: ${(e as Error).message}`);
  }

  const protocolIds = decoded.layers.map((l) => l.protocolId);
  const protocols = protocolIds.map((id) => registry.get(id)?.name ?? id);
  const ends = packet ? packetEndpoints(packet) : null;
  const ports = packet ? packetPorts(packet) : null;
  const topProtocol = protocols[protocols.length - 1] ?? '—';

  return {
    ...common,
    status: decoded.exact ? 'exact' : 'partial',
    packet,
    stack,
    protocols,
    protocolIds,
    topProtocol,
    source: ends?.src ?? null,
    destination: ends?.dst ?? null,
    srcPort: ports?.src ?? null,
    dstPort: ports?.dst ?? null,
    summary: summarize(topProtocol, ports, decoded.payload.length),
    notes,
    searchText: [
      searchText(packet, protocols, protocolIds, registry),
      record.comment?.toLowerCase() ?? '',
    ]
      .filter((part) => part !== '')
      .join(' '),
  };
}

/** A capture tool's info column, kept to what the decode actually established. */
function summarize(
  topProtocol: string,
  ports: { src: number; dst: number } | null,
  payloadBytes: number,
): string {
  const parts = [topProtocol];
  if (ports) parts.push(`${ports.src} → ${ports.dst}`);
  if (payloadBytes > 0) parts.push(`${payloadBytes} bytes payload`);
  return parts.join(' · ');
}

/**
 * The free-text haystack for one packet: protocol names and ids plus every
 * decoded field's name and rendered value, so a search for "SYN", "53", or
 * "192.0.2.1" finds packets by what the field editor would show.
 */
function searchText(
  packet: SerializedPacket | null,
  protocols: string[],
  protocolIds: string[],
  registry: Registry,
): string {
  const parts = [...protocols, ...protocolIds];
  if (packet) {
    const defByUid = new Map(
      packet.layers.map((l) => [l.uid, registry.get(l.protocolId)] as const),
    );
    for (const span of packet.spans) {
      const def = defByUid.get(span.layerUid);
      const field = def?.fields.find((f) => f.id === span.fieldId);
      if (!field) continue;
      parts.push(field.name);
      parts.push(renderValue(span.value, field.type));
      if (field.enumRef) {
        const label = registry.getEnum(field.enumRef)?.values[Number(span.value)];
        if (label) parts.push(label);
      }
      for (const flag of field.flags ?? []) {
        const width = typeof field.bitLength === 'number' ? field.bitLength : 8;
        if (Number(span.value) & (1 << (width - 1 - flag.bit))) parts.push(flag.name);
      }
    }
  }
  return parts.join(' ').toLowerCase();
}

/** Value rendering for search only — the UI has its own richer formatter. */
function renderValue(value: FieldValue, type: string): string {
  if (value instanceof Uint8Array) {
    if (type === 'mac' && value.length === 6) return formatMac(value);
    if (type === 'ipv4' && value.length === 4) return formatIPv4(value);
    if (type === 'ipv6' && value.length === 16) return formatIPv6(value);
    // Long opaque payloads would swamp the haystack; the head is enough to
    // find a magic number or a signature byte.
    return formatHexBytes(value.subarray(0, 32));
  }
  return String(value);
}
