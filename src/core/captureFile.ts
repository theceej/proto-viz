/**
 * The format-independent shape of a parsed capture, and the entry point that
 * picks a parser for a file.
 *
 * Two container formats reach this codebase — classic pcap (`pcapRead.ts`)
 * and pcapng (`pcapngRead.ts`) — and the capture viewer should not care which
 * one it was handed. Both parsers therefore produce the same `ReadCapture`,
 * and everything downstream works from that.
 *
 * The two formats differ in one way the record shape has to accommodate:
 * classic pcap fixes a single link type in its file header, while pcapng can
 * describe several interfaces with different link types in one file. Link
 * type is therefore a property of each record, not of the file — the
 * file-level value is kept only so the UI can name the capture's primary
 * interface.
 */

export type CaptureFormat = 'pcap' | 'pcapng';

export type TimestampPrecision = 'microsecond' | 'nanosecond';

export interface CaptureReadLimits {
  /** Reject files larger than this outright (bytes). */
  maxFileBytes: number;
  /** Stop after this many records; the rest is reported, not read. */
  maxPackets: number;
  /** Reject a record claiming to be larger than this (bytes). */
  maxPacketBytes: number;
}

export const DEFAULT_LIMITS: CaptureReadLimits = {
  maxFileBytes: 16 * 1024 * 1024,
  maxPackets: 2_000,
  // Generous next to the serializer's 256 KiB packet ceiling, but far below
  // anything that would stall the tab if a header lied about a record length.
  maxPacketBytes: 512 * 1024,
};

export interface CaptureRecord {
  /** 1-based position in the file, as capture tools number packets. */
  number: number;
  /** Captured bytes (`incl_len`), which may be shorter than `originalLength`. */
  bytes: Uint8Array;
  /** The packet's length on the wire before snapshotting. */
  originalLength: number;
  /** Absolute capture time in microseconds since the Unix epoch. */
  tsUsec: number;
  /**
   * Link type of the interface this packet arrived on. Constant across a
   * classic pcap file; per-interface in pcapng.
   */
  linkType: number;
  /** pcapng `opt_comment`, when the writer attached one. */
  comment?: string;
}

export interface ReadCapture {
  format: CaptureFormat;
  /** The capture's primary link type — the first interface's, in pcapng. */
  linkType: number;
  byteOrder: 'little' | 'big';
  timestampPrecision: TimestampPrecision;
  /** Snap length of the primary interface. */
  snapLength: number;
  records: CaptureRecord[];
  /** Non-fatal observations: truncation, caps hit, skipped records. */
  notes: string[];
  /** True when the file ended inside a record header or its data. */
  truncated: boolean;
  /** True when reading stopped because `maxPackets` was reached. */
  capped: boolean;
}

/** A capture file that cannot be read at all. */
export class CaptureReadError extends Error {}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Shared first check: nothing is parsed until the file is small enough. */
export function assertWithinFileCap(data: Uint8Array, limits: CaptureReadLimits): void {
  if (data.length > limits.maxFileBytes) {
    throw new CaptureReadError(
      `The file is ${formatBytes(data.length)}; the limit is ${formatBytes(limits.maxFileBytes)}.`,
    );
  }
}
