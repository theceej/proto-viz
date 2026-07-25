/**
 * pcapng: the block model shared by the writer below and the reader in
 * `pcapngRead.ts`.
 *
 * Where classic pcap is a fixed header followed by fixed records, pcapng is a
 * stream of self-describing blocks:
 *
 *   type (4) │ total length (4) │ body … │ total length again (4)
 *
 * The repeated trailing length is what makes the format walkable backwards
 * and — more usefully here — what lets a reader sanity-check a block before
 * trusting it. Every block is padded to a 4-byte boundary, and so is every
 * variable-length field inside one; getting that padding wrong is the classic
 * way to produce a file that looks right and parses as garbage.
 *
 * Three block types carry everything proto-viz writes:
 *
 * - **SHB** (Section Header Block) opens a section and fixes its byte order.
 * - **IDB** (Interface Description Block) declares one capture interface —
 *   its link type, snap length, and timestamp resolution.
 * - **EPB** (Enhanced Packet Block) is one packet, naming the interface it
 *   arrived on and carrying optional per-packet options.
 *
 * The per-packet `opt_comment` is the reason this format is worth supporting:
 * a generated exchange can ship with "SYN", "SYN-ACK", "DORA: Offer" attached
 * to the packets themselves, so the file explains itself in any tool that
 * reads pcapng.
 */

export const BLOCK = {
  /** Section Header Block. Doubles as the file's magic number. */
  SECTION_HEADER: 0x0a0d0d0a,
  /** Interface Description Block. */
  INTERFACE_DESCRIPTION: 0x00000001,
  /** Packet Block — obsolete, read but never written. */
  PACKET: 0x00000002,
  /** Simple Packet Block — no timestamp, no options. */
  SIMPLE_PACKET: 0x00000003,
  /** Enhanced Packet Block. */
  ENHANCED_PACKET: 0x00000006,
} as const;

/**
 * Written into the SHB so a reader can tell which byte order the section
 * uses: read as 0x1a2b3c4d it matches, byte-swapped it does not.
 */
export const BYTE_ORDER_MAGIC = 0x1a2b3c4d;

export const OPTION = {
  END_OF_OPT: 0,
  COMMENT: 1,
  /** SHB: the application that wrote the file. */
  SHB_USERAPPL: 4,
  /** IDB: the interface name. */
  IF_NAME: 2,
  /** IDB: timestamps are in units of 10^-value seconds. Default 6. */
  IF_TSRESOL: 9,
} as const;

/** Timestamps are written in microseconds, i.e. `if_tsresol` of 6. */
export const WRITE_TSRESOL = 6;

const VERSION_MAJOR = 1;
const VERSION_MINOR = 0;
const SNAPLEN = 65535;
const WRITER_NAME = 'proto-viz';

export interface PcapngPacket {
  bytes: Uint8Array;
  tsSec: number;
  tsUsec: number;
  /** Attached as `opt_comment`; capture tools show it against the packet. */
  comment?: string;
}

/** Bytes `n` must grow by to reach the next 4-byte boundary. */
const padding = (n: number): number => (4 - (n % 4)) % 4;

/** Length of one option once encoded: 4-byte header plus padded value. */
const optionLength = (valueBytes: number): number => 4 + valueBytes + padding(valueBytes);

/**
 * Write a pcapng file: one section, one interface, and one Enhanced Packet
 * Block per packet. Little-endian, matching the classic-pcap writer.
 */
export function writePcapng(packets: PcapngPacket[], linkType: number): Uint8Array {
  const appName = new TextEncoder().encode(WRITER_NAME);
  const comments = packets.map((p) =>
    p.comment ? new TextEncoder().encode(p.comment) : null,
  );

  // Section Header: byte-order magic, version, section length, options.
  const shbLength = 28 + optionLength(appName.length) + 4;
  // Interface Description: link type, snap length, if_tsresol option.
  const idbLength = 20 + optionLength(1) + 4;
  const epbLengths = packets.map((p, i) => {
    const comment = comments[i];
    // Fixed body is 20 bytes: interface id, both timestamp halves, both lengths.
    const base = 12 + 20 + p.bytes.length + padding(p.bytes.length);
    return comment ? base + optionLength(comment.length) + 4 : base;
  });

  const total = shbLength + idbLength + epbLengths.reduce((n, len) => n + len, 0);
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  let off = 0;

  const u32 = (value: number) => {
    view.setUint32(off, value, true);
    off += 4;
  };
  const u16 = (value: number) => {
    view.setUint16(off, value, true);
    off += 2;
  };
  /** One option: code, value length, value, padding to a 4-byte boundary. */
  const option = (code: number, value: Uint8Array) => {
    u16(code);
    u16(value.length);
    buf.set(value, off);
    off += value.length + padding(value.length);
  };
  const endOfOptions = () => {
    u16(OPTION.END_OF_OPT);
    u16(0);
  };

  u32(BLOCK.SECTION_HEADER);
  u32(shbLength);
  u32(BYTE_ORDER_MAGIC);
  u16(VERSION_MAJOR);
  u16(VERSION_MINOR);
  // Section length: -1 (unknown) as a 64-bit value, which is legal and saves
  // having to backfill it.
  view.setBigInt64(off, -1n, true);
  off += 8;
  option(OPTION.SHB_USERAPPL, appName);
  endOfOptions();
  u32(shbLength);

  u32(BLOCK.INTERFACE_DESCRIPTION);
  u32(idbLength);
  u16(linkType);
  u16(0); // reserved
  u32(SNAPLEN);
  option(OPTION.IF_TSRESOL, Uint8Array.of(WRITE_TSRESOL));
  endOfOptions();
  u32(idbLength);

  packets.forEach((packet, i) => {
    const comment = comments[i];
    const blockLength = epbLengths[i]!;
    // The 64-bit timestamp is stored as two 32-bit halves, high first, in
    // units of 10^-WRITE_TSRESOL seconds.
    const stamp = BigInt(packet.tsSec) * 1_000_000n + BigInt(packet.tsUsec);

    u32(BLOCK.ENHANCED_PACKET);
    u32(blockLength);
    u32(0); // interface id — the single IDB written above
    u32(Number(stamp >> 32n));
    u32(Number(stamp & 0xffffffffn));
    u32(packet.bytes.length); // captured length
    u32(packet.bytes.length); // original length
    buf.set(packet.bytes, off);
    off += packet.bytes.length + padding(packet.bytes.length);
    if (comment) {
      option(OPTION.COMMENT, comment);
      endOfOptions();
    }
    u32(blockLength);
  });

  return buf;
}
