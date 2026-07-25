import { describe, expect, it } from 'vitest';
import { readPcapng } from './pcapngRead';
import { BLOCK, BYTE_ORDER_MAGIC, OPTION, writePcapng } from './pcapng';
import { CaptureReadError, DEFAULT_LIMITS } from './captureFile';
import { LINKTYPE } from './pcap';

/**
 * Assemble a pcapng file from raw blocks. Each builder returns a block body;
 * `block` wraps it with the type, both lengths, and any padding — so tests
 * can describe malformed files a writer would never produce.
 */
function block(type: number, body: number[], little = true, lengthOverride?: number): number[] {
  const padded = [...body, ...new Array((4 - (body.length % 4)) % 4).fill(0)];
  const length = lengthOverride ?? padded.length + 12;
  return [...u32(type, little), ...u32(length, little), ...padded, ...u32(length, little)];
}

const u16 = (n: number, little = true) =>
  little ? [n & 0xff, (n >> 8) & 0xff] : [(n >> 8) & 0xff, n & 0xff];
const u32 = (n: number, little = true) =>
  little
    ? [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
    : [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

/** An option: code, value length, value, padded to a 4-byte boundary. */
const option = (code: number, value: number[], little = true) => [
  ...u16(code, little),
  ...u16(value.length, little),
  ...value,
  ...new Array((4 - (value.length % 4)) % 4).fill(0),
];
const endOfOptions = (little = true) => [...u16(OPTION.END_OF_OPT, little), ...u16(0, little)];

const sectionHeader = (little = true) =>
  block(
    BLOCK.SECTION_HEADER,
    [
      ...u32(BYTE_ORDER_MAGIC, little),
      ...u16(1, little),
      ...u16(0, little),
      ...new Array(8).fill(0xff), // section length -1
    ],
    little,
  );

const interfaceBlock = (linkType: number, tsResol?: number, little = true) =>
  block(
    BLOCK.INTERFACE_DESCRIPTION,
    [
      ...u16(linkType, little),
      ...u16(0, little),
      ...u32(65535, little),
      ...(tsResol === undefined ? [] : [...option(OPTION.IF_TSRESOL, [tsResol], little), ...endOfOptions(little)]),
    ],
    little,
  );

const enhancedPacket = (
  options: {
    interfaceId?: number;
    tsHigh?: number;
    tsLow?: number;
    data: number[];
    comment?: string;
    capturedOverride?: number;
    little?: boolean;
  },
) => {
  const little = options.little ?? true;
  const comment = options.comment
    ? [...option(OPTION.COMMENT, [...new TextEncoder().encode(options.comment)], little), ...endOfOptions(little)]
    : [];
  return block(
    BLOCK.ENHANCED_PACKET,
    [
      ...u32(options.interfaceId ?? 0, little),
      ...u32(options.tsHigh ?? 0, little),
      ...u32(options.tsLow ?? 0, little),
      ...u32(options.capturedOverride ?? options.data.length, little),
      ...u32(options.data.length, little),
      ...options.data,
      ...new Array((4 - (options.data.length % 4)) % 4).fill(0),
      ...comment,
    ],
    little,
  );
};

const file = (...parts: number[][]) => Uint8Array.from(parts.flat());

describe('readPcapng', () => {
  it('round-trips what writePcapng produces, comments included', () => {
    const bytes = Uint8Array.from([0xde, 0xad, 0xbe, 0xef, 0x01]);
    const written = writePcapng(
      [
        { bytes, tsSec: 1_700_000_000, tsUsec: 1234, comment: 'SYN' },
        { bytes, tsSec: 1_700_000_000, tsUsec: 5678 },
      ],
      LINKTYPE.ETHERNET,
    );
    const read = readPcapng(written);

    expect(read.format).toBe('pcapng');
    expect(read.byteOrder).toBe('little');
    expect(read.linkType).toBe(LINKTYPE.ETHERNET);
    expect(read.snapLength).toBe(65535);
    expect(read.records).toHaveLength(2);
    expect([...read.records[0]!.bytes]).toEqual([...bytes]);
    expect(read.records[0]!.tsUsec).toBe(1_700_000_000 * 1_000_000 + 1234);
    expect(read.records[0]!.comment).toBe('SYN');
    expect(read.records[1]!.comment).toBeUndefined();
    expect(read.records.map((r) => r.number)).toEqual([1, 2]);
    expect(read.truncated).toBe(false);
  });

  it('reads a big-endian section identically to a little-endian one', () => {
    const packet = { data: [1, 2, 3, 4], tsLow: 500 };
    const little = readPcapng(file(sectionHeader(), interfaceBlock(1), enhancedPacket(packet)));
    const big = readPcapng(
      file(
        sectionHeader(false),
        interfaceBlock(1, undefined, false),
        enhancedPacket({ ...packet, little: false }),
      ),
    );

    expect(big.byteOrder).toBe('big');
    expect(big.linkType).toBe(little.linkType);
    expect(big.records[0]!.tsUsec).toBe(little.records[0]!.tsUsec);
    expect([...big.records[0]!.bytes]).toEqual([...little.records[0]!.bytes]);
  });

  it('scales timestamps by the interface if_tsresol', () => {
    // if_tsresol 9: ticks are nanoseconds, so 1_500_000_000 ticks is 1.5 s.
    const read = readPcapng(
      file(
        sectionHeader(),
        interfaceBlock(1, 9),
        enhancedPacket({ data: [0, 0, 0, 0], tsLow: 1_500_000_000 }),
      ),
    );

    expect(read.timestampPrecision).toBe('nanosecond');
    expect(read.records[0]!.tsUsec).toBe(1_500_000);
  });

  it('reads a 64-bit timestamp split across both halves', () => {
    const stamp = BigInt(1_700_000_000) * 1_000_000n + 42n;
    const read = readPcapng(
      file(
        sectionHeader(),
        interfaceBlock(1),
        enhancedPacket({
          data: [0, 0, 0, 0],
          tsHigh: Number(stamp >> 32n),
          tsLow: Number(stamp & 0xffffffffn),
        }),
      ),
    );
    expect(read.records[0]!.tsUsec).toBe(Number(stamp));
  });

  it('gives each packet the link type of the interface it names', () => {
    const read = readPcapng(
      file(
        sectionHeader(),
        interfaceBlock(LINKTYPE.ETHERNET),
        interfaceBlock(LINKTYPE.RAW),
        enhancedPacket({ interfaceId: 0, data: [1, 1, 1, 1] }),
        enhancedPacket({ interfaceId: 1, data: [2, 2, 2, 2] }),
      ),
    );

    expect(read.records.map((r) => r.linkType)).toEqual([LINKTYPE.ETHERNET, LINKTYPE.RAW]);
    // The file-level link type names the capture's primary interface.
    expect(read.linkType).toBe(LINKTYPE.ETHERNET);
  });

  it('skips a packet naming an interface that was never described', () => {
    const read = readPcapng(
      file(
        sectionHeader(),
        interfaceBlock(1),
        enhancedPacket({ interfaceId: 7, data: [1, 2, 3, 4] }),
        enhancedPacket({ interfaceId: 0, data: [5, 6, 7, 8] }),
      ),
    );

    expect(read.records).toHaveLength(1);
    expect([...read.records[0]!.bytes]).toEqual([5, 6, 7, 8]);
    expect(read.notes.join(' ')).toMatch(/names interface 7, which was never described/);
  });

  it('reads a Simple Packet Block', () => {
    const read = readPcapng(
      file(
        sectionHeader(),
        interfaceBlock(LINKTYPE.ETHERNET),
        block(BLOCK.SIMPLE_PACKET, [...u32(4), 9, 8, 7, 6]),
      ),
    );

    expect(read.records).toHaveLength(1);
    expect([...read.records[0]!.bytes]).toEqual([9, 8, 7, 6]);
    expect(read.records[0]!.originalLength).toBe(4);
    // Simple Packet Blocks carry no timestamp at all.
    expect(read.records[0]!.tsUsec).toBe(0);
  });

  it('reads the obsolete Packet Block, whose interface id is 16-bit', () => {
    const read = readPcapng(
      file(
        sectionHeader(),
        interfaceBlock(LINKTYPE.RAW),
        block(BLOCK.PACKET, [
          ...u16(0), // interface id
          ...u16(0), // drops count
          ...u32(0), // timestamp high
          ...u32(250), // timestamp low
          ...u32(4), // captured length
          ...u32(4), // original length
          4, 5, 6, 7,
        ]),
      ),
    );

    expect(read.records).toHaveLength(1);
    expect([...read.records[0]!.bytes]).toEqual([4, 5, 6, 7]);
    expect(read.records[0]!.linkType).toBe(LINKTYPE.RAW);
  });

  it('skips a packet block too short to hold its own header', () => {
    const read = readPcapng(
      file(sectionHeader(), interfaceBlock(1), block(BLOCK.ENHANCED_PACKET, [...u32(0), ...u32(0)])),
    );
    expect(read.records).toHaveLength(0);
    expect(read.notes.join(' ')).toMatch(/too short to read/);
  });

  it('skips a Simple Packet Block arriving before any interface', () => {
    const read = readPcapng(
      file(sectionHeader(), block(BLOCK.SIMPLE_PACKET, [...u32(4), 1, 2, 3, 4])),
    );
    expect(read.records).toHaveLength(0);
    expect(read.notes.join(' ')).toMatch(/no interface has been described yet/);
  });

  it('assumes Ethernet for an Interface Description Block too short to read', () => {
    const read = readPcapng(
      file(sectionHeader(), block(BLOCK.INTERFACE_DESCRIPTION, [...u16(1), ...u16(0)])),
    );
    expect(read.notes.join(' ')).toMatch(/Interface Description Block was too short/);
  });

  it('skips block types it does not recognise', () => {
    const nameResolution = block(0x00000004, [...u32(0), ...u32(0)]);
    const read = readPcapng(
      file(
        sectionHeader(),
        interfaceBlock(1),
        nameResolution,
        enhancedPacket({ data: [1, 2, 3, 4] }),
        block(0x00000005, [...u32(0)]), // interface statistics
      ),
    );

    expect(read.records).toHaveLength(1);
    expect(read.truncated).toBe(false);
  });

  it('restarts interface numbering at a new section', () => {
    const read = readPcapng(
      file(
        sectionHeader(),
        interfaceBlock(LINKTYPE.ETHERNET),
        enhancedPacket({ data: [1, 1, 1, 1] }),
        sectionHeader(),
        interfaceBlock(LINKTYPE.RAW),
        enhancedPacket({ interfaceId: 0, data: [2, 2, 2, 2] }),
      ),
    );

    expect(read.records.map((r) => r.linkType)).toEqual([LINKTYPE.ETHERNET, LINKTYPE.RAW]);
    expect(read.notes.join(' ')).toMatch(/Section 2 starts here/);
  });

  it('rejects a file that does not open with a Section Header Block', () => {
    expect(() => readPcapng(file(interfaceBlock(1)))).toThrow(CaptureReadError);
    expect(() => readPcapng(file(interfaceBlock(1)))).toThrow(/does not start with a Section Header/);
  });

  it('rejects a Section Header Block with no valid byte-order magic', () => {
    const broken = [...sectionHeader()];
    broken.splice(8, 4, 0, 0, 0, 0);
    expect(() => readPcapng(Uint8Array.from(broken))).toThrow(/byte-order magic/);
  });

  it('rejects a block whose two lengths disagree', () => {
    // Both lengths are individually plausible — a multiple of 4, inside the
    // file — but they do not match, so the block cannot be trusted and
    // reading on from it would land mid-block.
    const corrupt = [...sectionHeader(), ...interfaceBlock(1)];
    corrupt.splice(corrupt.length - 4, 4, ...u32(16));

    expect(() => readPcapng(Uint8Array.from(corrupt))).toThrow(CaptureReadError);
    expect(() => readPcapng(Uint8Array.from(corrupt))).toThrow(
      /opens claiming 20 bytes and closes claiming 16/,
    );
  });

  it('rejects an impossible block length outright', () => {
    const bad = file(sectionHeader(), block(BLOCK.INTERFACE_DESCRIPTION, [], true, 8));
    expect(() => readPcapng(bad)).toThrow(/not a valid block size/);
  });

  it('reports a block running past the end of the file as truncation', () => {
    const whole = file(sectionHeader(), interfaceBlock(1), enhancedPacket({ data: [1, 2, 3, 4] }));
    const read = readPcapng(whole.slice(0, whole.length - 8));

    expect(read.records).toHaveLength(0);
    expect(read.truncated).toBe(true);
    expect(read.notes.join(' ')).toMatch(/runs past the end of the file/);
  });

  it('reports a file ending inside a block header', () => {
    const whole = file(sectionHeader(), interfaceBlock(1));
    const read = readPcapng(Uint8Array.from([...whole, 0x06, 0x00]));

    expect(read.truncated).toBe(true);
    expect(read.notes.join(' ')).toMatch(/inside a block header/);
  });

  it('refuses a packet claiming more bytes than the per-packet limit', () => {
    const bad = file(
      sectionHeader(),
      interfaceBlock(1),
      enhancedPacket({ data: [1, 2, 3, 4], capturedOverride: DEFAULT_LIMITS.maxPacketBytes + 1 }),
    );
    expect(() => readPcapng(bad)).toThrow(/per-packet limit/);
  });

  it('skips a packet whose captured length exceeds its own block', () => {
    const read = readPcapng(
      file(
        sectionHeader(),
        interfaceBlock(1),
        enhancedPacket({ data: [1, 2, 3, 4], capturedOverride: 400 }),
      ),
    );
    expect(read.records).toHaveLength(0);
    expect(read.notes.join(' ')).toMatch(/its block holds only/);
  });

  it('stops at the packet cap and says so', () => {
    const packets = Array.from({ length: 5 }, (_, i) => enhancedPacket({ data: [i, i, i, i] }));
    const read = readPcapng(file(sectionHeader(), interfaceBlock(1), ...packets), {
      ...DEFAULT_LIMITS,
      maxPackets: 3,
    });

    expect(read.records).toHaveLength(3);
    expect(read.capped).toBe(true);
    expect(read.notes.join(' ')).toMatch(/Stopped after 3 packets/);
  });

  it('refuses a file over the size cap without parsing it', () => {
    expect(() =>
      readPcapng(file(sectionHeader()), { ...DEFAULT_LIMITS, maxFileBytes: 8 }),
    ).toThrow(/the limit is 8 bytes/);
  });

  it('notes a valid file with no packets', () => {
    const read = readPcapng(file(sectionHeader(), interfaceBlock(1)));
    expect(read.records).toHaveLength(0);
    expect(read.notes.join(' ')).toMatch(/no packets/);
  });

  it('reports power-of-two timestamp resolution rather than mis-scaling it', () => {
    const read = readPcapng(
      file(sectionHeader(), interfaceBlock(1, 0x80 | 10), enhancedPacket({ data: [0, 0, 0, 0], tsLow: 5 })),
    );
    expect(read.notes.join(' ')).toMatch(/power-of-two timestamp resolution/);
    expect(read.records[0]!.tsUsec).toBe(5);
  });

  it('reads a capture that does not start at the buffer origin', () => {
    const whole = writePcapng([{ bytes: Uint8Array.of(1, 2, 3, 4), tsSec: 1, tsUsec: 0 }], 1);
    const padded = new Uint8Array(whole.length + 7);
    padded.set(whole, 7);

    const read = readPcapng(padded.subarray(7));
    expect(read.records).toHaveLength(1);
    expect([...read.records[0]!.bytes]).toEqual([1, 2, 3, 4]);
  });
});
