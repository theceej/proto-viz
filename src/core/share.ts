/**
 * Word-code sharing for stacks of built-in protocols.
 *
 * A stack's layer sequence packs into a short bit string (5 bits per layer
 * against a frozen protocol table, plus a version tag and an 8-bit CRC) and
 * reads out as words from the BIP-39 English list — 2048 curated words,
 * 11 bits each, unique in their first four letters. A three-layer stack is
 * exactly three words ("ethernet.ipv4.tcp" → e.g. "brief.solar.rescue"),
 * so codes can be spoken, typed, or put in a URL.
 *
 * Codes carry the layer composition only: field edits, pins, and payload
 * are not included, and custom protocols cannot be encoded.
 */
import { wordlist } from '@scure/bip39/wordlists/english.js';

/**
 * Positions in this table are baked into every share code ever issued.
 * Append new built-in protocols at the end; NEVER reorder or remove.
 */
export const SHARE_PROTOCOL_IDS: readonly string[] = [
  'ethernet',
  'vlan-8021q',
  'arp',
  'ipv4',
  'ipv6',
  'icmp',
  'icmpv6',
  'igmp',
  'tcp',
  'udp',
  'sctp',
  'dns',
  'dhcp',
  'http1',
  'tls',
  'ntp',
  'gre',
  'vxlan',
  'mpls',
  'ospf',
  'bgp',
  'pppoe',
  'l2tp',
  // -- library expansion (indices 23+; 32 and above require format v1) --
  'ethernet-8023',
  'stp',
  'lldp',
  'vrrp',
  'hsrp',
  'ripv2',
  'eigrp',
  'bfd',
  'dhcpv6',
  'tftp',
  'radius',
  'netflow5',
  'rtp',
  'rtcp',
  'stun',
  'ipsec-esp',
  'ipsec-ah',
  'websocket',
  'http2',
  'mqtt',
  'coap',
  'mdns',
  'llmnr',
  'wireguard',
  'geneve',
  'gtpu',
  'modbus',
  'smb2',
  'ftp',
  'smtp',
  'pop3',
  'imap',
  'telnet',
  'irc',
  'sip',
  'rtsp',
  'syslog',
  'ssdp',
  'ripv1',
  'pim',
  'nbns',
  'ethernet-snap',
  'cdp',
  'icmpv6-ndp',
];

export class ShareCodeError extends Error {}

/**
 * Format versions: v0 packs protocol indices in 5 bits (the original
 * 23-protocol library); v1 uses 7-bit indices for the expanded library.
 * The encoder emits v0 whenever every index fits, so codes for classic
 * stacks stay short and every code ever issued keeps decoding.
 */
const VERSION_BITS = 2;
const COUNT_BITS = 4;
const INDEX_BITS: Record<number, number> = { 0: 5, 1: 7 };
const CRC_BITS = 8;
const WORD_BITS = 11;
export const MAX_SHARE_LAYERS = (1 << COUNT_BITS) - 1;

/** CRC-8 (poly 0x07, init 0) over the payload bits packed into bytes. */
function crc8(bytes: number[]): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

/** MSB-first bit accumulator over a bigint. */
class Bits {
  value = 0n;
  length = 0;
  push(v: number, bits: number): void {
    this.value = (this.value << BigInt(bits)) | BigInt(v);
    this.length += bits;
  }
  /** Read `bits` starting at absolute offset `at` (0 = first pushed bit). */
  read(at: number, bits: number): number {
    const shift = BigInt(this.length - at - bits);
    return Number((this.value >> shift) & ((1n << BigInt(bits)) - 1n));
  }
  toBytes(): number[] {
    const padded = new Bits();
    padded.value = this.value;
    padded.length = this.length;
    if (this.length % 8 !== 0) padded.push(0, 8 - (this.length % 8));
    const bytes: number[] = [];
    for (let at = 0; at < padded.length; at += 8) bytes.push(padded.read(at, 8));
    return bytes;
  }
}

/** Encode a sequence of built-in protocol ids as a dot-separated word code. */
export function encodeShare(protocolIds: string[]): string {
  if (protocolIds.length === 0) {
    throw new ShareCodeError('Add at least one layer to share a stack.');
  }
  if (protocolIds.length > MAX_SHARE_LAYERS) {
    throw new ShareCodeError(
      `Stacks longer than ${MAX_SHARE_LAYERS} layers cannot be shared.`,
    );
  }
  const indices = protocolIds.map((id) => {
    const index = SHARE_PROTOCOL_IDS.indexOf(id);
    if (index < 0) {
      throw new ShareCodeError(
        `“${id}” is not a built-in protocol — only built-in protocols can be shared.`,
      );
    }
    return index;
  });

  const version = indices.every((i) => i < 1 << INDEX_BITS[0]!) ? 0 : 1;
  const payload = new Bits();
  payload.push(version, VERSION_BITS);
  payload.push(indices.length, COUNT_BITS);
  for (const index of indices) payload.push(index, INDEX_BITS[version]!);

  const bits = new Bits();
  bits.value = payload.value;
  bits.length = payload.length;
  bits.push(crc8(payload.toBytes()), CRC_BITS);
  const pad = (WORD_BITS - (bits.length % WORD_BITS)) % WORD_BITS;
  if (pad > 0) bits.push(0, pad);

  const words: string[] = [];
  for (let at = 0; at < bits.length; at += WORD_BITS) {
    words.push(wordlist[bits.read(at, WORD_BITS)]!);
  }
  return words.join('.');
}

function resolveWord(token: string): number {
  const exact = wordlist.indexOf(token);
  if (exact >= 0) return exact;
  // BIP-39 words are unique in their first four letters, so accept prefixes.
  if (token.length >= 4) {
    const matches = wordlist.filter((w) => w.startsWith(token));
    if (matches.length === 1) return wordlist.indexOf(matches[0]!);
  }
  throw new ShareCodeError(`“${token}” is not a word this code format uses.`);
}

/** Decode a word code back to its protocol id sequence. */
export function decodeShare(text: string): string[] {
  const tokens = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (tokens.length === 0) throw new ShareCodeError('Enter a share code.');

  const bits = new Bits();
  for (const token of tokens) bits.push(resolveWord(token), WORD_BITS);

  const malformed = new ShareCodeError(
    'That does not look like a valid share code — check the words and try again.',
  );
  if (bits.length < VERSION_BITS + COUNT_BITS) throw malformed;
  const version = bits.read(0, VERSION_BITS);
  const indexBits = INDEX_BITS[version];
  if (indexBits === undefined) {
    throw new ShareCodeError(
      'This code was made by a newer version of proto-viz — refresh to update.',
    );
  }
  const count = bits.read(VERSION_BITS, COUNT_BITS);
  const payloadLength = VERSION_BITS + COUNT_BITS + count * indexBits;
  const total = payloadLength + CRC_BITS;
  if (count === 0 || Math.ceil(total / WORD_BITS) !== tokens.length) throw malformed;

  const payload = new Bits();
  payload.value = bits.value >> BigInt(bits.length - payloadLength);
  payload.length = payloadLength;
  if (bits.read(payloadLength, CRC_BITS) !== crc8(payload.toBytes())) throw malformed;
  for (let at = total; at < bits.length; at++) if (bits.read(at, 1) !== 0) throw malformed;

  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const index = bits.read(VERSION_BITS + COUNT_BITS + i * indexBits, indexBits);
    const id = SHARE_PROTOCOL_IDS[index];
    if (id === undefined) throw malformed;
    ids.push(id);
  }
  return ids;
}
