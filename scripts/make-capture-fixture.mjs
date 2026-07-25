/**
 * Generates the sample captures used by the capture-viewer tests:
 *
 *   fixtures/capture-handshake.pcap    classic pcap, little-endian, µs
 *   fixtures/capture-handshake.pcapng  pcapng, with a comment per packet
 *
 * Deliberately self-contained: it builds the frames *and both containers*
 * from raw bytes rather than importing proto-viz's own writers, so the
 * fixtures are an *independent* witness. A bug that made the writer and the
 * reader agree with each other but disagree with the format would still be
 * caught, which would not be true of a file the app generated for itself.
 *
 *   node scripts/make-capture-fixture.mjs
 *
 * Contents — two conversations between three hosts, unpadded (no trailing
 * Ethernet padding, so every byte belongs to a modeled header):
 *
 *   1  0.000000  A:49152 → B:80      TCP SYN
 *   2  0.000420  B:80    → A:49152   TCP SYN-ACK
 *   3  0.000560  A:49152 → B:80      TCP ACK
 *   4  0.002000  A:53000 → D:53      DNS query   A? example.com
 *   5  0.014000  D:53    → A:53000   DNS response  example.com A 198.51.100.20
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MAC_A = [0x02, 0x00, 0x00, 0x00, 0x00, 0x0a];
const MAC_B = [0x02, 0x00, 0x00, 0x00, 0x00, 0x14];
const MAC_D = [0x02, 0x00, 0x00, 0x00, 0x00, 0x35];
const IP_A = [192, 0, 2, 10];
const IP_B = [198, 51, 100, 20];
const IP_D = [198, 51, 100, 53];

const u16 = (n) => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

/** RFC 1071 internet checksum: one's-complement sum of 16-bit words. */
function checksum(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 2) {
    sum += ((bytes[i] << 8) | (bytes[i + 1] ?? 0)) >>> 0;
  }
  while (sum >>> 16) sum = (sum & 0xffff) + (sum >>> 16);
  return (~sum) & 0xffff;
}

const ethernet = (dstMac, srcMac) => [...dstMac, ...srcMac, 0x08, 0x00];

/** IPv4 header with its own checksum filled in. `proto` is 6 (TCP) or 17 (UDP). */
function ipv4(srcIp, dstIp, proto, payloadLength, id) {
  const header = [
    0x45, // version 4, IHL 5
    0x00, // DSCP/ECN
    ...u16(20 + payloadLength), // total length
    ...u16(id),
    0x40, // flags: don't fragment
    0x00, // fragment offset
    0x40, // TTL 64
    proto,
    0x00, 0x00, // checksum placeholder
    ...srcIp,
    ...dstIp,
  ];
  const sum = checksum(header);
  header[10] = (sum >> 8) & 0xff;
  header[11] = sum & 0xff;
  return header;
}

/** The IPv4 pseudo-header TCP and UDP checksums cover (RFC 793 / RFC 768). */
const pseudoHeader = (srcIp, dstIp, proto, length) => [
  ...srcIp,
  ...dstIp,
  0x00,
  proto,
  ...u16(length),
];

/** TCP segment, header only (no options, no data), with a real checksum. */
function tcp(srcIp, dstIp, srcPort, dstPort, seq, ack, flags, window) {
  const segment = [
    ...u16(srcPort),
    ...u16(dstPort),
    ...u32(seq),
    ...u32(ack),
    0x50, // data offset 5 words, reserved 0
    flags,
    ...u16(window),
    0x00, 0x00, // checksum placeholder
    0x00, 0x00, // urgent pointer
  ];
  const sum = checksum([...pseudoHeader(srcIp, dstIp, 6, segment.length), ...segment]);
  segment[16] = (sum >> 8) & 0xff;
  segment[17] = sum & 0xff;
  return segment;
}

/** UDP datagram with a real checksum over the pseudo-header, header and data. */
function udp(srcIp, dstIp, srcPort, dstPort, data) {
  const datagram = [
    ...u16(srcPort),
    ...u16(dstPort),
    ...u16(8 + data.length),
    0x00, 0x00, // checksum placeholder
    ...data,
  ];
  const sum = checksum([...pseudoHeader(srcIp, dstIp, 17, datagram.length), ...datagram]);
  datagram[6] = (sum >> 8) & 0xff;
  datagram[7] = sum & 0xff;
  return datagram;
}

/** "example.com" as uncompressed DNS labels; compression is never used here. */
const dnsName = (name) =>
  name.split('.').flatMap((label) => [label.length, ...[...label].map((c) => c.charCodeAt(0))]).concat(0);

/** DNS message: header, one question, and optionally one uncompressed answer. */
function dns(id, flags, answer) {
  return [
    ...u16(id),
    ...u16(flags),
    ...u16(1), // QDCOUNT
    ...u16(answer ? 1 : 0), // ANCOUNT
    ...u16(0), // NSCOUNT
    ...u16(0), // ARCOUNT
    ...dnsName('example.com'),
    ...u16(1), // QTYPE A
    ...u16(1), // QCLASS IN
    ...(answer ?? []),
  ];
}

const dnsAnswer = [
  ...dnsName('example.com'),
  ...u16(1), // TYPE A
  ...u16(1), // CLASS IN
  ...u32(300), // TTL
  ...u16(4), // RDLENGTH
  ...IP_B, // RDATA
];

const frame = (dstMac, srcMac, srcIp, dstIp, proto, payload, ipId) => [
  ...ethernet(dstMac, srcMac),
  ...ipv4(srcIp, dstIp, proto, payload.length, ipId),
  ...payload,
];

const SYN = 0x02;
const SYN_ACK = 0x12;
const ACK = 0x10;

const packets = [
  {
    usec: 0,
    comment: 'SYN',
    bytes: frame(MAC_B, MAC_A, IP_A, IP_B, 6, tcp(IP_A, IP_B, 49152, 80, 1000, 0, SYN, 64240), 1),
  },
  {
    usec: 420,
    comment: 'SYN-ACK',
    bytes: frame(MAC_A, MAC_B, IP_B, IP_A, 6, tcp(IP_B, IP_A, 80, 49152, 5000, 1001, SYN_ACK, 65535), 2),
  },
  {
    usec: 560,
    comment: 'ACK',
    bytes: frame(MAC_B, MAC_A, IP_A, IP_B, 6, tcp(IP_A, IP_B, 49152, 80, 1001, 5001, ACK, 64240), 3),
  },
  {
    usec: 2_000,
    comment: 'DNS query',
    // 0x0100: standard query, recursion desired.
    bytes: frame(MAC_D, MAC_A, IP_A, IP_D, 17, udp(IP_A, IP_D, 53000, 53, dns(0x1234, 0x0100, null)), 4),
  },
  {
    usec: 14_000,
    comment: 'DNS response',
    // 0x8180: response, recursion desired and available, no error.
    bytes: frame(MAC_A, MAC_D, IP_D, IP_A, 17, udp(IP_D, IP_A, 53, 53000, dns(0x1234, 0x8180, dnsAnswer)), 5),
  },
];

// Classic pcap, little-endian, microsecond resolution, LINKTYPE_ETHERNET.
const BASE_SEC = 1_760_000_000;
const header = [
  ...u32(0xd4c3b2a1), // 0xa1b2c3d4 written little-endian
  0x02, 0x00, 0x04, 0x00, // version 2.4
  0x00, 0x00, 0x00, 0x00, // thiszone
  0x00, 0x00, 0x00, 0x00, // sigfigs
  0xff, 0xff, 0x00, 0x00, // snaplen 65535
  0x01, 0x00, 0x00, 0x00, // LINKTYPE_ETHERNET
];

const le32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const body = packets.flatMap(({ usec, bytes }) => [
  ...le32(BASE_SEC + Math.floor(usec / 1_000_000)),
  ...le32(usec % 1_000_000),
  ...le32(bytes.length),
  ...le32(bytes.length),
  ...bytes,
]);

const pcapOut = resolve('fixtures/capture-handshake.pcap');
writeFileSync(pcapOut, Buffer.from([...header, ...body]));
console.log(`Wrote ${pcapOut}: ${packets.length} packets, ${header.length + body.length} bytes.`);

// ---------------------------------------------------------------------------
// The same packets as pcapng, with each step name attached as an opt_comment.
//
// pcapng is a stream of blocks: type, total length, body, and the total length
// again. Everything — the block itself and every variable-length field inside
// it — pads to a 4-byte boundary, and the padding counts towards the block
// length but never towards a value's own length field.
// ---------------------------------------------------------------------------

const pad4 = (n) => new Array((4 - (n % 4)) % 4).fill(0);
const le16 = (n) => [n & 0xff, (n >>> 8) & 0xff];

/** One option: code, value length, value, padding. */
const ngOption = (code, value) => [...le16(code), ...le16(value.length), ...value, ...pad4(value.length)];
const OPT_END = [...le16(0), ...le16(0)];
const ascii = (s) => [...Buffer.from(s, 'utf8')];

/** Wrap a block body with its type and the two length fields. */
function ngBlock(type, body) {
  const length = body.length + 12;
  return [...le32(type), ...le32(length), ...body, ...le32(length)];
}

// Section Header: byte-order magic, version 1.0, unknown section length.
const shb = ngBlock(0x0a0d0d0a, [
  ...le32(0x1a2b3c4d),
  ...le16(1),
  ...le16(0),
  ...new Array(8).fill(0xff), // section length: -1, unknown
  ...ngOption(4, ascii('proto-viz fixture')), // shb_userappl
  ...OPT_END,
]);

// Interface Description: Ethernet, snaplen 65535, microsecond timestamps.
const idb = ngBlock(0x00000001, [
  ...le16(1), // LINKTYPE_ETHERNET
  ...le16(0), // reserved
  ...le32(65535),
  ...ngOption(9, [6]), // if_tsresol: 10^-6 seconds
  ...OPT_END,
]);

const epbs = packets.flatMap(({ usec, bytes, comment }) => {
  // The 64-bit timestamp is a microsecond count split into two 32-bit halves.
  const stamp = BigInt(BASE_SEC) * 1_000_000n + BigInt(usec);
  return ngBlock(0x00000006, [
    ...le32(0), // interface id
    ...le32(Number(stamp >> 32n)),
    ...le32(Number(stamp & 0xffffffffn)),
    ...le32(bytes.length), // captured length
    ...le32(bytes.length), // original length
    ...bytes,
    ...pad4(bytes.length),
    ...ngOption(1, ascii(comment)), // opt_comment
    ...OPT_END,
  ]);
});

const pcapng = [...shb, ...idb, ...epbs];
const pcapngOut = resolve('fixtures/capture-handshake.pcapng');
writeFileSync(pcapngOut, Buffer.from(pcapng));
console.log(`Wrote ${pcapngOut}: ${packets.length} packets, ${pcapng.length} bytes.`);
