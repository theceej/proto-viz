import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, PcapReadError, readPcap } from './pcapRead';
import { LINKTYPE, writePcap } from './pcap';

/** Build a classic pcap file in either byte order and timestamp resolution. */
function buildFile(options: {
  packets: { bytes: number[]; tsSec: number; tsFraction: number; origLen?: number }[];
  little?: boolean;
  nanosecond?: boolean;
  linkType?: number;
  versionMinor?: number;
}): Uint8Array {
  const {
    packets,
    little = true,
    nanosecond = false,
    linkType = LINKTYPE.ETHERNET,
    versionMinor = 4,
  } = options;
  const total = 24 + packets.reduce((n, p) => n + 16 + p.bytes.length, 0);
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);

  view.setUint32(0, nanosecond ? 0xa1b23c4d : 0xa1b2c3d4, little);
  view.setUint16(4, 2, little);
  view.setUint16(6, versionMinor, little);
  view.setInt32(8, 0, little);
  view.setUint32(12, 0, little);
  view.setUint32(16, 65535, little);
  view.setUint32(20, linkType, little);

  let off = 24;
  for (const p of packets) {
    view.setUint32(off, p.tsSec, little);
    view.setUint32(off + 4, p.tsFraction, little);
    view.setUint32(off + 8, p.bytes.length, little);
    view.setUint32(off + 12, p.origLen ?? p.bytes.length, little);
    buf.set(p.bytes, off + 16);
    off += 16 + p.bytes.length;
  }
  return buf;
}

const onePacket = [{ bytes: [1, 2, 3, 4], tsSec: 1_700_000_000, tsFraction: 250_000 }];

describe('readPcap', () => {
  it('round-trips what writePcap produces', () => {
    const payload = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
    const file = writePcap(
      [{ bytes: payload, tsSec: 1_700_000_000, tsUsec: 1234 }],
      LINKTYPE.ETHERNET,
    );
    const read = readPcap(file);

    expect(read.linkType).toBe(LINKTYPE.ETHERNET);
    expect(read.byteOrder).toBe('little');
    expect(read.timestampPrecision).toBe('microsecond');
    expect(read.snapLength).toBe(65535);
    expect(read.records).toHaveLength(1);
    expect([...read.records[0]!.bytes]).toEqual([...payload]);
    expect(read.records[0]!.tsUsec).toBe(1_700_000_000 * 1_000_000 + 1234);
    expect(read.truncated).toBe(false);
  });

  it('reads big-endian files identically to little-endian ones', () => {
    const little = readPcap(buildFile({ packets: onePacket, little: true }));
    const big = readPcap(buildFile({ packets: onePacket, little: false }));

    expect(big.byteOrder).toBe('big');
    expect(big.linkType).toBe(little.linkType);
    expect(big.snapLength).toBe(little.snapLength);
    expect(big.records[0]!.tsUsec).toBe(little.records[0]!.tsUsec);
    expect([...big.records[0]!.bytes]).toEqual([...little.records[0]!.bytes]);
  });

  it('scales nanosecond timestamps down to microseconds', () => {
    const read = readPcap(
      buildFile({
        packets: [{ bytes: [0], tsSec: 5, tsFraction: 123_456_789 }],
        nanosecond: true,
      }),
    );
    expect(read.timestampPrecision).toBe('nanosecond');
    expect(read.records[0]!.tsUsec).toBe(5_000_000 + 123_456);
  });

  it('numbers records from one and records the original length', () => {
    const read = readPcap(
      buildFile({
        packets: [
          { bytes: [1, 2], tsSec: 1, tsFraction: 0, origLen: 60 },
          { bytes: [3, 4], tsSec: 2, tsFraction: 0 },
        ],
      }),
    );
    expect(read.records.map((r) => r.number)).toEqual([1, 2]);
    expect(read.records[0]!.originalLength).toBe(60);
    expect(read.records[1]!.originalLength).toBe(2);
  });

  it('rejects pcapng by name rather than as a bad magic number', () => {
    const buf = new Uint8Array(24);
    new DataView(buf.buffer).setUint32(0, 0x0a0d0d0a, false);
    expect(() => readPcap(buf)).toThrow(PcapReadError);
    expect(() => readPcap(buf)).toThrow(/pcapng/);
  });

  it('rejects a file that is not a capture at all', () => {
    const buf = new TextEncoder().encode('not a capture file at all, honest');
    expect(() => readPcap(buf)).toThrow(/Not a classic pcap file/);
  });

  it('rejects a file too short to hold a header', () => {
    expect(() => readPcap(new Uint8Array(8))).toThrow(/at least a 24-byte header/);
  });

  it('rejects an unsupported major version', () => {
    const file = buildFile({ packets: onePacket });
    new DataView(file.buffer).setUint16(4, 3, true);
    expect(() => readPcap(file)).toThrow(/Unsupported pcap version 3/);
  });

  it('notes an unexpected minor version but still reads the file', () => {
    const read = readPcap(buildFile({ packets: onePacket, versionMinor: 2 }));
    expect(read.records).toHaveLength(1);
    expect(read.notes.join(' ')).toMatch(/version 2\.2/);
  });

  it('keeps the records before a truncated final packet', () => {
    const file = buildFile({
      packets: [
        { bytes: [1, 2, 3, 4], tsSec: 1, tsFraction: 0 },
        { bytes: [5, 6, 7, 8], tsSec: 2, tsFraction: 0 },
      ],
    });
    const read = readPcap(file.slice(0, file.length - 3));

    expect(read.records).toHaveLength(1);
    expect(read.truncated).toBe(true);
    expect(read.notes.join(' ')).toMatch(/truncated/);
  });

  it('reports a file ending inside a record header', () => {
    const file = buildFile({ packets: onePacket });
    const read = readPcap(file.slice(0, 24 + 9));

    expect(read.records).toHaveLength(0);
    expect(read.truncated).toBe(true);
    expect(read.notes.join(' ')).toMatch(/inside a packet record header/);
  });

  it('refuses a record claiming more bytes than the per-packet limit', () => {
    const file = buildFile({ packets: onePacket });
    new DataView(file.buffer).setUint32(24 + 8, DEFAULT_LIMITS.maxPacketBytes + 1, true);
    expect(() => readPcap(file)).toThrow(/per-packet limit/);
  });

  it('stops at the packet cap and says so', () => {
    const file = buildFile({
      packets: Array.from({ length: 5 }, (_, i) => ({
        bytes: [i],
        tsSec: i,
        tsFraction: 0,
      })),
    });
    const read = readPcap(file, { ...DEFAULT_LIMITS, maxPackets: 3 });

    expect(read.records).toHaveLength(3);
    expect(read.capped).toBe(true);
    expect(read.notes.join(' ')).toMatch(/Stopped after 3 packets/);
  });

  it('refuses a file over the size cap without parsing it', () => {
    const file = buildFile({ packets: onePacket });
    expect(() => readPcap(file, { ...DEFAULT_LIMITS, maxFileBytes: 8 })).toThrow(
      /the limit is 8 bytes/,
    );
  });

  it('notes a valid header with no packets', () => {
    const read = readPcap(buildFile({ packets: [] }));
    expect(read.records).toHaveLength(0);
    expect(read.truncated).toBe(false);
    expect(read.notes.join(' ')).toMatch(/no packets/);
  });

  it('reads a capture that does not start at the buffer origin', () => {
    // `new Uint8Array(await file.arrayBuffer())` can hand us a view with a
    // non-zero byteOffset; the DataView must be built from the view, not the
    // whole underlying buffer.
    const file = buildFile({ packets: onePacket });
    const padded = new Uint8Array(file.length + 7);
    padded.set(file, 7);
    const view = padded.subarray(7);

    const read = readPcap(view);
    expect(read.records).toHaveLength(1);
    expect([...read.records[0]!.bytes]).toEqual([1, 2, 3, 4]);
  });
});
