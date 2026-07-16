/** Classic pcap (libpcap) file writer. */

export const LINKTYPE = {
  ETHERNET: 1,
  RAW: 101, // packet begins with an IPv4/IPv6 header
  USER0: 147,
} as const;

export interface PcapPacket {
  bytes: Uint8Array;
  tsSec: number;
  tsUsec: number;
}

const MAGIC = 0xa1b2c3d4; // microsecond-resolution, little-endian
const SNAPLEN = 65535;

export function writePcap(packets: PcapPacket[], linkType: number): Uint8Array {
  const total = 24 + packets.reduce((n, p) => n + 16 + p.bytes.length, 0);
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);

  view.setUint32(0, MAGIC, true);
  view.setUint16(4, 2, true); // version major
  view.setUint16(6, 4, true); // version minor
  view.setInt32(8, 0, true); // thiszone
  view.setUint32(12, 0, true); // sigfigs
  view.setUint32(16, SNAPLEN, true);
  view.setUint32(20, linkType, true);

  let off = 24;
  for (const p of packets) {
    view.setUint32(off, p.tsSec, true);
    view.setUint32(off + 4, p.tsUsec, true);
    view.setUint32(off + 8, p.bytes.length, true); // incl_len
    view.setUint32(off + 12, p.bytes.length, true); // orig_len
    buf.set(p.bytes, off + 16);
    off += 16 + p.bytes.length;
  }
  return buf;
}
