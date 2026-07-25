import { describe, expect, it } from 'vitest';
import { BLOCK, BYTE_ORDER_MAGIC, OPTION, writePcapng } from './pcapng';
import { LINKTYPE } from './pcap';
import { newLayer, type StackInstance } from './model';
import { serializeStack } from './serialize';
import { createBuiltinRegistry } from '../protocols';

const registry = createBuiltinRegistry();
const read = (file: Uint8Array) => new DataView(file.buffer, file.byteOffset, file.byteLength);

describe('writePcapng', () => {
  it('writes a byte-exact Section Header Block', () => {
    const file = writePcapng([], LINKTYPE.ETHERNET);
    const v = read(file);

    expect(v.getUint32(0, true)).toBe(BLOCK.SECTION_HEADER);
    // 24 fixed bytes + a 16-byte shb_userappl option + 4 end-of-options + 4 trailing.
    expect(v.getUint32(4, true)).toBe(48);
    expect(v.getUint32(8, true)).toBe(BYTE_ORDER_MAGIC);
    expect(v.getUint16(12, true)).toBe(1); // version major
    expect(v.getUint16(14, true)).toBe(0); // version minor
    expect(v.getBigInt64(16, true)).toBe(-1n); // section length: unknown
    expect(v.getUint16(24, true)).toBe(OPTION.SHB_USERAPPL);
    expect(v.getUint16(26, true)).toBe(9); // "proto-viz"
    expect(new TextDecoder().decode(file.subarray(28, 37))).toBe('proto-viz');
    expect([...file.subarray(37, 40)]).toEqual([0, 0, 0]); // padded to 4 bytes
    expect(v.getUint16(40, true)).toBe(OPTION.END_OF_OPT);
    expect(v.getUint16(42, true)).toBe(0);
    // The trailing length repeats the opening one — the format's own check.
    expect(v.getUint32(44, true)).toBe(48);
  });

  it('writes a byte-exact Interface Description Block', () => {
    const file = writePcapng([], LINKTYPE.RAW);
    const v = read(file);
    const at = 48;

    expect(v.getUint32(at, true)).toBe(BLOCK.INTERFACE_DESCRIPTION);
    // 16 fixed bytes + an 8-byte if_tsresol option + 4 end-of-options + 4 trailing.
    expect(v.getUint32(at + 4, true)).toBe(32);
    expect(v.getUint16(at + 8, true)).toBe(LINKTYPE.RAW);
    expect(v.getUint16(at + 10, true)).toBe(0); // reserved
    expect(v.getUint32(at + 12, true)).toBe(65535); // snaplen
    expect(v.getUint16(at + 16, true)).toBe(OPTION.IF_TSRESOL);
    expect(v.getUint16(at + 18, true)).toBe(1);
    expect(file[at + 20]).toBe(6); // microseconds
    expect([...file.subarray(at + 21, at + 24)]).toEqual([0, 0, 0]);
    expect(v.getUint16(at + 24, true)).toBe(OPTION.END_OF_OPT);
    expect(v.getUint32(at + 28, true)).toBe(32);
    expect(file.length).toBe(80); // header blocks only
  });

  it('writes a byte-exact Enhanced Packet Block', () => {
    const bytes = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
    const file = writePcapng([{ bytes, tsSec: 1_700_000_000, tsUsec: 1234 }], LINKTYPE.ETHERNET);
    const v = read(file);
    const at = 80;

    expect(v.getUint32(at, true)).toBe(BLOCK.ENHANCED_PACKET);
    // 8 framing + 20 fixed body + 4 data (already aligned) + 4 trailing.
    expect(v.getUint32(at + 4, true)).toBe(36);
    expect(v.getUint32(at + 8, true)).toBe(0); // interface id

    // The 64-bit microsecond timestamp, split high then low.
    const stamp = BigInt(1_700_000_000) * 1_000_000n + 1234n;
    expect(v.getUint32(at + 12, true)).toBe(Number(stamp >> 32n));
    expect(v.getUint32(at + 16, true)).toBe(Number(stamp & 0xffffffffn));

    expect(v.getUint32(at + 20, true)).toBe(4); // captured length
    expect(v.getUint32(at + 24, true)).toBe(4); // original length
    expect([...file.subarray(at + 28, at + 32)]).toEqual([...bytes]);
    expect(v.getUint32(at + 32, true)).toBe(36);
    expect(file.length).toBe(116);
  });

  it('pads packet data to a 4-byte boundary without changing the lengths', () => {
    // 5 bytes of data needs 3 bytes of padding that belong to neither length.
    const bytes = Uint8Array.from([1, 2, 3, 4, 5]);
    const file = writePcapng([{ bytes, tsSec: 1, tsUsec: 0 }], LINKTYPE.ETHERNET);
    const v = read(file);
    const at = 80;

    expect(v.getUint32(at + 4, true)).toBe(40); // 32 + 5 data + 3 padding
    expect(v.getUint32(at + 20, true)).toBe(5); // captured length is still 5
    expect([...file.subarray(at + 28, at + 33)]).toEqual([...bytes]);
    expect([...file.subarray(at + 33, at + 36)]).toEqual([0, 0, 0]);
    expect(file.length % 4).toBe(0);
  });

  it('attaches a per-packet comment as an option', () => {
    const file = writePcapng(
      [{ bytes: Uint8Array.of(0, 0, 0, 0), tsSec: 1, tsUsec: 0, comment: 'SYN' }],
      LINKTYPE.ETHERNET,
    );
    const v = read(file);
    const at = 80;

    // 32 base + 4 data + 8-byte comment option + 4 end-of-options.
    expect(v.getUint32(at + 4, true)).toBe(48);
    expect(v.getUint16(at + 32, true)).toBe(OPTION.COMMENT);
    expect(v.getUint16(at + 34, true)).toBe(3);
    expect(new TextDecoder().decode(file.subarray(at + 36, at + 39))).toBe('SYN');
    expect(file[at + 39]).toBe(0); // padded
    expect(v.getUint16(at + 40, true)).toBe(OPTION.END_OF_OPT);
    expect(v.getUint32(at + 44, true)).toBe(48);
  });

  it('omits the options section entirely when a packet has no comment', () => {
    const withComment = writePcapng(
      [{ bytes: Uint8Array.of(0, 0, 0, 0), tsSec: 1, tsUsec: 0, comment: 'x' }],
      LINKTYPE.ETHERNET,
    );
    const without = writePcapng(
      [{ bytes: Uint8Array.of(0, 0, 0, 0), tsSec: 1, tsUsec: 0 }],
      LINKTYPE.ETHERNET,
    );
    expect(without.length).toBeLessThan(withComment.length);
    expect(read(without).getUint32(84, true)).toBe(36);
  });

  it('keeps every block 4-byte aligned across a multi-packet file', () => {
    const stack: StackInstance = { layers: ['ethernet', 'ipv4', 'tcp'].map(newLayer) };
    const bytes = serializeStack(stack, registry).bytes;
    const file = writePcapng(
      [
        { bytes, tsSec: 1, tsUsec: 0, comment: 'SYN' },
        { bytes: bytes.slice(0, 41), tsSec: 1, tsUsec: 500, comment: 'SYN-ACK' },
        { bytes, tsSec: 2, tsUsec: 0 },
      ],
      LINKTYPE.ETHERNET,
    );

    // Walk the blocks; every one must land on a 4-byte boundary and close
    // with a length matching the one it opened with.
    const v = read(file);
    let offset = 0;
    const types: number[] = [];
    while (offset < file.length) {
      expect(offset % 4).toBe(0);
      const length = v.getUint32(offset + 4, true);
      expect(v.getUint32(offset + length - 4, true)).toBe(length);
      types.push(v.getUint32(offset, true));
      offset += length;
    }
    expect(offset).toBe(file.length);
    expect(types).toEqual([
      BLOCK.SECTION_HEADER,
      BLOCK.INTERFACE_DESCRIPTION,
      BLOCK.ENHANCED_PACKET,
      BLOCK.ENHANCED_PACKET,
      BLOCK.ENHANCED_PACKET,
    ]);
  });
});
