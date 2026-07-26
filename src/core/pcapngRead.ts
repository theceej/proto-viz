/**
 * pcapng reader.
 *
 * Where the classic-pcap reader walks fixed-size records, this walks a stream
 * of self-describing blocks (see `pcapng.ts` for the layout). Three
 * consequences shape the code:
 *
 * - **Byte order is per section, not per file.** The Section Header Block's
 *   byte-order magic sets it, and a file may hold several sections that
 *   disagree — so each new SHB re-reads it and resets the interface table.
 * - **Link type and timestamp resolution are per interface, not per file.**
 *   A packet block names the interface it arrived on; its link type and its
 *   `if_tsresol` scale come from that interface's IDB. One file can mix
 *   Ethernet and raw IP, so records carry their own link type.
 * - **Unknown block types are normal.** Name-resolution blocks, statistics,
 *   decryption secrets, vendor blocks — a reader that fails on anything it
 *   does not recognise fails on ordinary files. They are skipped by length.
 *
 * The repeated trailing length on every block is a genuine integrity check,
 * not ceremony: a block whose two lengths disagree is corrupt, and reading on
 * from it would walk into the middle of a packet. That check is what stops a
 * malformed file from producing confident nonsense.
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
import { BLOCK, BYTE_ORDER_MAGIC, OPTION } from './pcapng';

/** Type, length, and the repeated trailing length: the smallest legal block. */
const MIN_BLOCK_BYTES = 12;
/** A block header we must be able to read before trusting its length. */
const BLOCK_HEADER_BYTES = 8;

interface Interface {
  linkType: number;
  snapLength: number;
  /** Timestamps are in units of 10^-tsResol seconds. */
  tsResol: number;
}

/** One decoded option: its code and raw value bytes. */
interface Option {
  code: number;
  value: Uint8Array;
}

/**
 * Parse a pcapng file. Throws `CaptureReadError` only when nothing meaningful
 * can be read; recoverable problems become notes on the result.
 */
export function readPcapng(
  data: Uint8Array,
  limits: CaptureReadLimits = DEFAULT_LIMITS,
): ReadCapture {
  assertWithinFileCap(data, limits);
  if (data.length < MIN_BLOCK_BYTES) {
    throw new CaptureReadError(
      `A pcapng file needs at least a ${MIN_BLOCK_BYTES}-byte block; this file is ${data.length} bytes.`,
    );
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0, false) !== BLOCK.SECTION_HEADER) {
    throw new CaptureReadError(
      `Not a pcapng file: it does not start with a Section Header Block (0x${view
        .getUint32(0, false)
        .toString(16)
        .padStart(8, '0')}).`,
    );
  }

  const notes: string[] = [];
  const records: CaptureRecord[] = [];
  let interfaces: Interface[] = [];
  let little = true;
  let firstByteOrder: 'little' | 'big' | null = null;
  let sections = 0;
  let offset = 0;
  let truncated = false;
  let capped = false;

  while (offset < data.length) {
    if (offset + BLOCK_HEADER_BYTES > data.length) {
      truncated = true;
      notes.push(`The file ends inside a block header (${data.length - offset} trailing bytes).`);
      break;
    }

    const blockType = view.getUint32(offset, little);
    // A section header decides its own byte order, so its length must be read
    // only after the byte-order magic that follows it has been checked.
    const isSection = view.getUint32(offset, false) === BLOCK.SECTION_HEADER;
    if (isSection) {
      const resolved = readSectionByteOrder(view, offset, data.length);
      little = resolved === 'little';
      firstByteOrder ??= resolved;
      sections += 1;
      if (sections > 1) {
        // A new section restarts interface numbering; carrying the old table
        // over would attribute packets to the wrong link type.
        interfaces = [];
        notes.push(`Section ${sections} starts here; its interfaces are numbered afresh.`);
      }
    }

    const blockLength = view.getUint32(offset + 4, little);
    if (blockLength < MIN_BLOCK_BYTES || blockLength % 4 !== 0) {
      throw new CaptureReadError(
        `Block at byte ${offset} claims a length of ${blockLength}, which is not a valid block size.`,
      );
    }
    if (blockLength > limits.maxFileBytes) {
      throw new CaptureReadError(
        `Block at byte ${offset} claims ${formatBytes(blockLength)}; the file is only ${formatBytes(data.length)}.`,
      );
    }
    if (offset + blockLength > data.length) {
      truncated = true;
      notes.push(
        `A ${blockLength}-byte block at byte ${offset} runs past the end of the file; the capture is truncated.`,
      );
      break;
    }
    const trailingLength = view.getUint32(offset + blockLength - 4, little);
    if (trailingLength !== blockLength) {
      throw new CaptureReadError(
        `Block at byte ${offset} is corrupt: it opens claiming ${blockLength} bytes and closes claiming ${trailingLength}.`,
      );
    }

    // Body between the length fields, i.e. excluding the 12 bytes of framing.
    const body = data.subarray(offset + BLOCK_HEADER_BYTES, offset + blockLength - 4);

    if (!isSection) {
      if (blockType === BLOCK.INTERFACE_DESCRIPTION) {
        interfaces.push(readInterface(body, little, notes));
      } else if (
        blockType === BLOCK.ENHANCED_PACKET ||
        blockType === BLOCK.SIMPLE_PACKET ||
        blockType === BLOCK.PACKET
      ) {
        if (records.length >= limits.maxPackets) {
          capped = true;
          notes.push(
            `Stopped after ${limits.maxPackets} packets — the rest of the file was not read.`,
          );
          break;
        }
        const record = readPacketBlock(
          blockType,
          body,
          little,
          interfaces,
          records.length + 1,
          limits,
          notes,
        );
        if (record) records.push(record);
      }
      // Anything else — name resolution, statistics, custom blocks — is
      // skipped. Its length has already been validated.
    }

    offset += blockLength;
  }

  const primary = interfaces[0];
  if (records.length === 0 && !truncated) {
    notes.push('The file is valid pcapng but contains no packets.');
  }

  return {
    format: 'pcapng',
    linkType: records[0]?.linkType ?? primary?.linkType ?? 0,
    byteOrder: firstByteOrder ?? 'little',
    // pcapng stores an exponent per interface; report the finer of the two
    // buckets the rest of the app models when any interface is sub-microsecond.
    timestampPrecision: precisionOf(interfaces),
    snapLength: primary?.snapLength ?? 0,
    records,
    notes,
    truncated,
    capped,
  };
}

/** Read a Section Header Block's byte-order magic. */
function readSectionByteOrder(
  view: DataView,
  offset: number,
  fileLength: number,
): 'little' | 'big' {
  if (offset + 12 > fileLength) {
    throw new CaptureReadError('The file ends inside a Section Header Block.');
  }
  if (view.getUint32(offset + 8, true) === BYTE_ORDER_MAGIC) return 'little';
  if (view.getUint32(offset + 8, false) === BYTE_ORDER_MAGIC) return 'big';
  throw new CaptureReadError(
    `Section Header Block at byte ${offset} has no valid byte-order magic, so its byte order is unknowable.`,
  );
}

/** Interface Description Block: link type, snap length, and options. */
function readInterface(body: Uint8Array, little: boolean, notes: string[]): Interface {
  if (body.length < 8) {
    notes.push('An Interface Description Block was too short to read; assuming Ethernet.');
    return { linkType: 1, snapLength: 0, tsResol: 6 };
  }
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const linkType = view.getUint16(0, little);
  const snapLength = view.getUint32(4, little);

  let tsResol = 6;
  for (const option of readOptions(body.subarray(8), little)) {
    if (option.code !== OPTION.IF_TSRESOL || option.value.length < 1) continue;
    const raw = option.value[0]!;
    if (raw & 0x80) {
      // The high bit selects negative powers of two rather than of ten. Rare,
      // and converting it exactly would need a different representation, so
      // it is reported instead of silently mis-scaling every timestamp.
      notes.push(
        'An interface uses power-of-two timestamp resolution, which is not supported; its timestamps are read as microseconds.',
      );
    } else {
      tsResol = raw;
    }
  }
  return { linkType, snapLength, tsResol };
}

/**
 * A packet block in any of its three shapes. Returns null when the block
 * cannot be attributed to an interface or is otherwise unreadable — a note
 * explains why and the walk continues.
 */
function readPacketBlock(
  blockType: number,
  body: Uint8Array,
  little: boolean,
  interfaces: Interface[],
  number: number,
  limits: CaptureReadLimits,
  notes: string[],
): CaptureRecord | null {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);

  if (blockType === BLOCK.SIMPLE_PACKET) {
    // A Simple Packet Block carries only the original length; the captured
    // data is whatever the block holds, and there is no timestamp at all.
    if (body.length < 4) {
      notes.push(`Packet ${number}: Simple Packet Block too short to read.`);
      return null;
    }
    const iface = interfaces[0];
    if (!iface) {
      notes.push(`Packet ${number}: no interface has been described yet; skipped.`);
      return null;
    }
    const originalLength = view.getUint32(0, little);
    const captured = iface.snapLength === 0
      ? originalLength
      : Math.min(originalLength, iface.snapLength);
    if (captured > limits.maxPacketBytes) {
      throw new CaptureReadError(
        `Packet ${number} claims ${formatBytes(captured)} of data; the per-packet limit is ${formatBytes(limits.maxPacketBytes)}.`,
      );
    }
    if (4 + captured > body.length) {
      notes.push(
        `Packet ${number} needs ${captured} bytes after applying its interface snap length, but its block holds only ${body.length - 4}; skipped.`,
      );
      return null;
    }
    return {
      number,
      bytes: body.slice(4, 4 + captured),
      originalLength,
      tsUsec: 0,
      linkType: iface.linkType,
    };
  }

  // Enhanced Packet Block and the obsolete Packet Block share a layout for
  // the fields that matter: an interface reference, a split 64-bit
  // timestamp, then the captured and original lengths.
  if (body.length < 20) {
    notes.push(`Packet ${number}: packet block too short to read.`);
    return null;
  }
  const interfaceId =
    blockType === BLOCK.PACKET ? view.getUint16(0, little) : view.getUint32(0, little);
  const iface = interfaces[interfaceId];
  if (!iface) {
    notes.push(`Packet ${number}: names interface ${interfaceId}, which was never described.`);
    return null;
  }

  const tsHigh = view.getUint32(4, little);
  const tsLow = view.getUint32(8, little);
  const capturedLength = view.getUint32(12, little);
  const originalLength = view.getUint32(16, little);

  if (capturedLength > limits.maxPacketBytes) {
    throw new CaptureReadError(
      `Packet ${number} claims ${formatBytes(capturedLength)} of data; the per-packet limit is ${formatBytes(limits.maxPacketBytes)}.`,
    );
  }
  if (20 + capturedLength > body.length) {
    notes.push(
      `Packet ${number} claims ${capturedLength} bytes but its block holds only ${body.length - 20}; skipped.`,
    );
    return null;
  }

  const data = body.slice(20, 20 + capturedLength);
  // Options follow the packet data, padded to a 4-byte boundary.
  const optionsAt = 20 + capturedLength + ((4 - (capturedLength % 4)) % 4);
  let comment: string | undefined;
  if (blockType === BLOCK.ENHANCED_PACKET && optionsAt < body.length) {
    for (const option of readOptions(body.subarray(optionsAt), little)) {
      if (option.code === OPTION.COMMENT) {
        comment = new TextDecoder().decode(option.value);
        break;
      }
    }
  }

  return {
    number,
    bytes: data,
    originalLength,
    tsUsec: toMicroseconds(tsHigh, tsLow, iface.tsResol),
    linkType: iface.linkType,
    ...(comment !== undefined && comment !== '' ? { comment } : {}),
  };
}

/**
 * Rescale a split 64-bit interface timestamp to microseconds. The count is
 * in units of 10^-tsResol seconds, so a resolution finer than microseconds
 * divides down and a coarser one multiplies up.
 */
function toMicroseconds(high: number, low: number, tsResol: number): number {
  const ticks = BigInt(high) * 0x1_0000_0000n + BigInt(low);
  const exponent = tsResol - 6;
  const scaled =
    exponent >= 0
      ? ticks / 10n ** BigInt(exponent)
      : ticks * 10n ** BigInt(-exponent);
  return Number(scaled);
}

/** The precision bucket to report for a set of interfaces. */
function precisionOf(interfaces: Interface[]): TimestampPrecision {
  return interfaces.some((iface) => iface.tsResol > 6) ? 'nanosecond' : 'microsecond';
}

/**
 * Walk an options area: code (2), value length (2), value padded to a 4-byte
 * boundary, terminated by `opt_endofopt`. A malformed run simply ends the
 * walk — options are metadata, never worth failing a file over.
 */
function readOptions(area: Uint8Array, little: boolean): Option[] {
  const options: Option[] = [];
  if (area.length < 4) return options;
  const view = new DataView(area.buffer, area.byteOffset, area.byteLength);
  let offset = 0;

  while (offset + 4 <= area.length) {
    const code = view.getUint16(offset, little);
    const length = view.getUint16(offset + 2, little);
    if (code === OPTION.END_OF_OPT) break;
    const valueAt = offset + 4;
    if (valueAt + length > area.length) break;
    options.push({ code, value: area.subarray(valueAt, valueAt + length) });
    offset = valueAt + length + ((4 - (length % 4)) % 4);
  }
  return options;
}
