import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { E } from '../core/expr';

/**
 * IPv6 extension headers (RFC 8200 §4). Each one claims `ip-proto` with its
 * own Next Header value and re-provides the same namespace via its own Next
 * Header field, so chains like IPv6 › Hop-by-Hop › Fragment › TCP validate
 * and auto-set with no special engine support — the same trick 802.1Q uses
 * to make Q-in-Q fall out of the binding model.
 */

/** Hdr Ext Len: header length in 8-octet units, not counting the first 8 octets. */
const hdrExtLen = E.sub(E.div(E.headerBytes(), E.const(8)), E.const(1));

/** Options field length in bytes: (Hdr Ext Len + 1) × 8, minus the two fixed octets. */
const optionsBytes = E.sub(
  E.mul(E.add(E.field('hdrExtLen'), E.const(1)), E.const(8)),
  E.const(2),
);

export const ipv6HopByHop: ProtocolDefinition = {
  id: 'ipv6-hopopts',
  name: 'IPv6 Hop-by-Hop',
  fullName: 'IPv6 Hop-by-Hop Options Header',
  layerHint: 'network',
  source: 'builtin',
  references: ['RFC 8200'],
  description:
    'Options examined by every router on the path (Next Header 0). Must sit immediately after the IPv6 header — the model cannot enforce that ordering, so place it first yourself. Options are raw TLV bytes and must fill the header to a multiple of 8 octets; the default is a 6-byte PadN option.',
  fields: [
    { id: 'nextHeader', name: 'Next Header', type: 'uint', bitLength: 8, default: 6, enumRef: 'ip-proto', computed: { kind: 'binding' }, description: 'Protocol of the following header (auto-set).' },
    {
      id: 'hdrExtLen', name: 'Hdr Ext Len', type: 'uint', bitLength: 8,
      computed: { kind: 'expr', expr: hdrExtLen },
      description: 'Header length in 8-octet units, not including the first 8 octets.',
    },
    {
      id: 'options', name: 'Options', type: 'bytes', bitLength: 'auto',
      decodeBitLength: { expr: optionsBytes, unit: 'bytes' },
      default: new Uint8Array([0x01, 0x04, 0x00, 0x00, 0x00, 0x00]),
      description: 'TLV-encoded options; pad so the whole header is a multiple of 8 octets (default: PadN).',
    },
  ],
  providesNamespaces: [
    { id: NS.ipProto, displayName: 'Next Header', selectorFieldId: 'nextHeader' },
  ],
  encapsulations: [{ namespaceId: NS.ipProto, value: 0 }],
};

export const ipv6Routing: ProtocolDefinition = {
  id: 'ipv6-routing',
  name: 'IPv6 Routing',
  fullName: 'IPv6 Routing Header (Segment Routing)',
  layerHint: 'network',
  source: 'builtin',
  references: ['RFC 8200', 'RFC 8754'],
  description:
    'Directs the packet through intermediate nodes (Next Header 43). Modeled as an SRv6 Segment Routing Header (Routing Type 4) with exactly one segment — real SRHs carry a variable-length segment list. Shown as received at its final destination (Segments Left 0), so the segment coincides with the IPv6 Destination Address; a transport checksum over this header therefore uses that address. With Segments Left > 0 the pseudo-header would instead use the last segment (RFC 8200 §8.1), which this fixed model does not compute.',
  fields: [
    { id: 'nextHeader', name: 'Next Header', type: 'uint', bitLength: 8, default: 6, enumRef: 'ip-proto', computed: { kind: 'binding' }, description: 'Protocol of the following header (auto-set).' },
    {
      id: 'hdrExtLen', name: 'Hdr Ext Len', type: 'uint', bitLength: 8,
      computed: { kind: 'expr', expr: hdrExtLen },
      description: 'Header length in 8-octet units, not including the first 8 octets (2 with one segment).',
    },
    { id: 'routingType', name: 'Routing Type', type: 'uint', bitLength: 8, default: 4, description: '4 = Segment Routing Header (SRv6).' },
    { id: 'segmentsLeft', name: 'Segments Left', type: 'uint', bitLength: 8, default: 0, description: 'Segments still to be visited (0 = final destination reached).' },
    { id: 'lastEntry', name: 'Last Entry', type: 'uint', bitLength: 8, default: 0, description: 'Index of the last segment list entry (0 with one segment).' },
    { id: 'srhFlags', name: 'Flags', type: 'uint', bitLength: 8, default: 0, description: 'Unused; must be 0.' },
    { id: 'tag', name: 'Tag', type: 'uint', bitLength: 16, default: 0, description: 'Marks a group of packets; 0 when unused.' },
    { id: 'segment0', name: 'Segment List [0]', type: 'ipv6', bitLength: 128, default: '2001:db8::2', description: 'The segment endpoint; equals the Destination Address once Segments Left reaches 0.' },
  ],
  providesNamespaces: [
    { id: NS.ipProto, displayName: 'Next Header', selectorFieldId: 'nextHeader' },
  ],
  encapsulations: [{ namespaceId: NS.ipProto, value: 43 }],
};

export const ipv6Fragment: ProtocolDefinition = {
  id: 'ipv6-frag',
  name: 'IPv6 Fragment',
  fullName: 'IPv6 Fragment Header',
  layerHint: 'network',
  source: 'builtin',
  references: ['RFC 8200'],
  description:
    'Carries one fragment of a larger packet (Next Header 44) — in IPv6 only the source fragments, never routers. Defaults describe a first fragment (offset 0, M set); the payload that follows is the start of the fragmented packet.',
  fields: [
    { id: 'nextHeader', name: 'Next Header', type: 'uint', bitLength: 8, default: 6, enumRef: 'ip-proto', computed: { kind: 'binding' }, description: 'Protocol of the fragmented packet (auto-set).' },
    { id: 'reserved', name: 'Reserved', type: 'uint', bitLength: 8, default: 0 },
    { id: 'fragmentOffset', name: 'Fragment Offset', type: 'uint', bitLength: 13, default: 0, description: 'Position of this fragment in 8-octet units.' },
    { id: 'res', name: 'Res', type: 'uint', bitLength: 2, default: 0 },
    {
      id: 'm', name: 'M', type: 'flags', bitLength: 1, default: 1,
      flags: [{ bit: 0, name: 'M', description: 'More Fragments' }],
      description: 'Set on every fragment except the last.',
    },
    { id: 'identification', name: 'Identification', type: 'uint', bitLength: 32, default: 0x0001, description: 'Same value in every fragment of a packet.' },
  ],
  providesNamespaces: [
    { id: NS.ipProto, displayName: 'Next Header', selectorFieldId: 'nextHeader' },
  ],
  encapsulations: [{ namespaceId: NS.ipProto, value: 44 }],
};

export const ipv6DestOptions: ProtocolDefinition = {
  id: 'ipv6-dstopts',
  name: 'IPv6 Dest Options',
  fullName: 'IPv6 Destination Options Header',
  layerHint: 'network',
  source: 'builtin',
  references: ['RFC 8200'],
  description:
    'Options examined only by the destination (Next Header 60). Options are raw TLV bytes and must fill the header to a multiple of 8 octets; the default is a 6-byte PadN option.',
  fields: [
    { id: 'nextHeader', name: 'Next Header', type: 'uint', bitLength: 8, default: 6, enumRef: 'ip-proto', computed: { kind: 'binding' }, description: 'Protocol of the following header (auto-set).' },
    {
      id: 'hdrExtLen', name: 'Hdr Ext Len', type: 'uint', bitLength: 8,
      computed: { kind: 'expr', expr: hdrExtLen },
      description: 'Header length in 8-octet units, not including the first 8 octets.',
    },
    {
      id: 'options', name: 'Options', type: 'bytes', bitLength: 'auto',
      decodeBitLength: { expr: optionsBytes, unit: 'bytes' },
      default: new Uint8Array([0x01, 0x04, 0x00, 0x00, 0x00, 0x00]),
      description: 'TLV-encoded options; pad so the whole header is a multiple of 8 octets (default: PadN).',
    },
  ],
  providesNamespaces: [
    { id: NS.ipProto, displayName: 'Next Header', selectorFieldId: 'nextHeader' },
  ],
  encapsulations: [{ namespaceId: NS.ipProto, value: 60 }],
};
