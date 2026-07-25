/**
 * Classic pcap (libpcap) file reader — the inverse of `writePcap`.
 *
 * The file header's magic number carries two independent facts: the byte
 * order every subsequent field is written in, and whether the per-packet
 * timestamp fraction counts microseconds or nanoseconds. Both readings of
 * both variants are accepted; pcapng (a different container entirely) is
 * recognised only so a caller reaching this parser directly is told to use
 * the pcapng one instead.
 *
 * Everything here treats the file as hostile input: it is read from a
 * `Uint8Array` the browser handed us, never a trusted producer. Record
 * lengths are bounds-checked against what is actually left in the buffer
 * before any allocation, and the caller's caps bound total work regardless
 * of what the header claims. A capture that ends mid-record is reported as
 * truncated with the records that *did* parse — that is what a killed
 * tcpdump leaves behind, and it is still worth reading.
 */
import {
  assertWithinFileCap,
  CaptureReadError,
  DEFAULT_LIMITS,
  formatBytes,
  type CaptureReadLimits,
  type CaptureRecord,
  type ReadCapture,
  type TimestampPrecision,
} from './captureFile';
import { BLOCK } from './pcapng';

const MAGIC_USEC = 0xa1b2c3d4;
const MAGIC_NSEC = 0xa1b23c4d;

const FILE_HEADER_BYTES = 24;
const RECORD_HEADER_BYTES = 16;

/**
 * Parse a classic pcap file. Throws `CaptureReadError` only when nothing
 * meaningful can be read (wrong format, impossible header, over the size
 * cap); anything recoverable becomes a note on the result.
 */
export function readPcap(
  data: Uint8Array,
  limits: CaptureReadLimits = DEFAULT_LIMITS,
): ReadCapture {
  assertWithinFileCap(data, limits);
  if (data.length < FILE_HEADER_BYTES) {
    throw new CaptureReadError(
      `A pcap file needs at least a ${FILE_HEADER_BYTES}-byte header; this file is ${data.length} bytes.`,
    );
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const { byteOrder, timestampPrecision } = readMagic(view);
  const little = byteOrder === 'little';

  const versionMajor = view.getUint16(4, little);
  const versionMinor = view.getUint16(6, little);
  if (versionMajor !== 2) {
    throw new CaptureReadError(
      `Unsupported pcap version ${versionMajor}.${versionMinor}; this reader handles version 2.x.`,
    );
  }

  const snapLength = view.getUint32(16, little);
  const linkType = view.getUint32(20, little);

  const notes: string[] = [];
  if (versionMinor !== 4) {
    notes.push(`File claims pcap version ${versionMajor}.${versionMinor}; reading it as 2.4.`);
  }

  const records: CaptureRecord[] = [];
  let offset = FILE_HEADER_BYTES;
  let truncated = false;
  let capped = false;

  while (offset < data.length) {
    if (records.length >= limits.maxPackets) {
      capped = true;
      notes.push(
        `Stopped after ${limits.maxPackets} packets — the rest of the file was not read.`,
      );
      break;
    }
    if (offset + RECORD_HEADER_BYTES > data.length) {
      truncated = true;
      notes.push(
        `The file ends inside a packet record header (${data.length - offset} trailing bytes).`,
      );
      break;
    }

    const tsSec = view.getUint32(offset, little);
    const tsFraction = view.getUint32(offset + 4, little);
    const inclLength = view.getUint32(offset + 8, little);
    const originalLength = view.getUint32(offset + 12, little);

    if (inclLength > limits.maxPacketBytes) {
      throw new CaptureReadError(
        `Packet ${records.length + 1} claims ${formatBytes(inclLength)} of data; the per-packet limit is ${formatBytes(limits.maxPacketBytes)}. The file is probably not a classic pcap capture.`,
      );
    }
    if (offset + RECORD_HEADER_BYTES + inclLength > data.length) {
      truncated = true;
      notes.push(
        `Packet ${records.length + 1} claims ${inclLength} bytes but only ${data.length - offset - RECORD_HEADER_BYTES} remain; the capture is truncated.`,
      );
      break;
    }

    const start = offset + RECORD_HEADER_BYTES;
    records.push({
      number: records.length + 1,
      bytes: data.slice(start, start + inclLength),
      originalLength,
      tsUsec:
        tsSec * 1_000_000 +
        (timestampPrecision === 'nanosecond' ? Math.floor(tsFraction / 1000) : tsFraction),
      linkType,
    });
    offset = start + inclLength;
  }

  if (records.length === 0 && !truncated) {
    notes.push('The file header is valid but the capture contains no packets.');
  }

  return {
    format: 'pcap',
    linkType,
    byteOrder,
    timestampPrecision,
    snapLength,
    records,
    notes,
    truncated,
    capped,
  };
}

/** Resolve the file's magic number into a byte order and timestamp unit. */
function readMagic(view: DataView): {
  byteOrder: 'little' | 'big';
  timestampPrecision: TimestampPrecision;
} {
  const little = view.getUint32(0, true);
  if (little === MAGIC_USEC) return { byteOrder: 'little', timestampPrecision: 'microsecond' };
  if (little === MAGIC_NSEC) return { byteOrder: 'little', timestampPrecision: 'nanosecond' };

  // A big-endian writer's magic reads as the byte-swapped constant here.
  const big = view.getUint32(0, false);
  if (big === MAGIC_USEC) return { byteOrder: 'big', timestampPrecision: 'microsecond' };
  if (big === MAGIC_NSEC) return { byteOrder: 'big', timestampPrecision: 'nanosecond' };

  if (big === BLOCK.SECTION_HEADER) {
    throw new CaptureReadError('This is a pcapng file; read it with readPcapng.');
  }
  throw new CaptureReadError(
    `Not a classic pcap file: the header starts with 0x${big.toString(16).padStart(8, '0')}, not a pcap magic number.`,
  );
}
