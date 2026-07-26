/**
 * Capture filtering: a small structured predicate over decoded packets.
 *
 * Deliberately *not* a display-filter language. Wireshark's syntax is a
 * parser, a field dictionary, and an error-reporting story of its own; what a
 * capture in a learning tool actually needs is "show me the DNS", "show me
 * what 192.0.2.1 sent", "show me what didn't decode". Every criterion is an
 * independent field, all of them AND together, and an empty filter matches
 * everything — so the UI can bind each control to one key and never has to
 * explain a syntax error.
 *
 * Free text is matched against the packet's summary and the rendered values
 * of its decoded fields (see `searchText` in capture.ts), which is why
 * searching "SYN" or "example.com" works without any field-name syntax.
 */
import type { CapturePacket, DecodeStatus } from './capture';

export interface CaptureFilter {
  /** Free text, matched case-insensitively against summary and field values. */
  text: string;
  /** Protocol id (e.g. 'tcp'); matches a packet with that layer anywhere. */
  protocolId: string | null;
  /** Address substring, matched against source or destination. */
  address: string;
  /** Transport port; matches source or destination. */
  port: number | null;
  /** Inclusive bounds on the packet's captured length in bytes. */
  minLength: number | null;
  maxLength: number | null;
  status: DecodeStatus | null;
}

export const EMPTY_FILTER: CaptureFilter = {
  text: '',
  protocolId: null,
  address: '',
  port: null,
  minLength: null,
  maxLength: null,
  status: null,
};

/** True when no criterion is set, i.e. the filter matches every packet. */
export function isEmptyFilter(filter: CaptureFilter): boolean {
  return (
    filter.text.trim() === '' &&
    filter.protocolId === null &&
    filter.address.trim() === '' &&
    filter.port === null &&
    filter.minLength === null &&
    filter.maxLength === null &&
    filter.status === null
  );
}

import { matchesDisplayFilter, parseDisplayFilter } from './displayFilter';

/** Does one packet satisfy every set criterion? */
export function matchesFilter(packet: CapturePacket, filter: CaptureFilter): boolean {
  const text = filter.text.trim();
  if (text !== '') {
    const parsed = parseDisplayFilter(text);
    if (parsed.ast && parsed.isDisplayFilter) {
      if (!matchesDisplayFilter(packet, parsed.ast)) return false;
    } else {
      const lowerText = text.toLowerCase();
      const haystack = `${packet.summary.toLowerCase()} ${packet.searchText}`;
      // Space-separated terms all have to appear, so "tcp 443" narrows rather
      // than looking for that exact string.
      if (!lowerText.split(/\s+/).every((term) => haystack.includes(term))) return false;
    }
  }

  if (filter.protocolId !== null && !packet.protocolIds.includes(filter.protocolId)) {
    return false;
  }

  const address = filter.address.trim().toLowerCase();
  if (address !== '') {
    const src = packet.source?.toLowerCase() ?? '';
    const dst = packet.destination?.toLowerCase() ?? '';
    if (!src.includes(address) && !dst.includes(address)) return false;
  }

  if (filter.port !== null && packet.srcPort !== filter.port && packet.dstPort !== filter.port) {
    return false;
  }

  if (filter.minLength !== null && packet.capturedLength < filter.minLength) return false;
  if (filter.maxLength !== null && packet.capturedLength > filter.maxLength) return false;
  if (filter.status !== null && packet.status !== filter.status) return false;

  return true;
}

/** The subset of `packets` the filter admits, in capture order. */
export function filterPackets(
  packets: CapturePacket[],
  filter: CaptureFilter,
): CapturePacket[] {
  if (isEmptyFilter(filter)) return packets;
  return packets.filter((packet) => matchesFilter(packet, filter));
}

/**
 * Protocol ids present in a capture with how many packets contain each,
 * ordered by depth then name so the protocol picker reads outermost-first
 * (Ethernet, IPv4, TCP, HTTP) rather than alphabetically.
 */
export function protocolOptions(
  packets: CapturePacket[],
): { id: string; name: string; count: number }[] {
  const counts = new Map<string, { name: string; count: number; depth: number }>();
  for (const packet of packets) {
    packet.protocolIds.forEach((id, depth) => {
      const existing = counts.get(id);
      if (existing) {
        existing.count += 1;
        existing.depth = Math.min(existing.depth, depth);
      } else {
        counts.set(id, { name: packet.protocols[depth] ?? id, count: 1, depth });
      }
    });
  }
  return [...counts.entries()]
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name))
    .map(({ id, name, count }) => ({ id, name, count }));
}
