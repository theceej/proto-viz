/**
 * The transport checksum a *receiver* computes, as opposed to the one a sender
 * emitted.
 *
 * `serializeStack` builds the pseudo-header from ground truth: the real byte
 * count of the packet (`segmentLength` in `serialize.ts`) and the transport
 * protocol's own IP-proto claim (`ownProto`). That is exactly right for a
 * sender, which knows what it is emitting.
 *
 * A receiver knows none of it. It derives the segment length from the IP
 * header's Total Length — or, for UDP, from the UDP header's own Length field
 * (RFC 768) — and the protocol number from the IP header's Protocol / Next
 * Header field. When one of those fields lies, because it was pinned in the
 * field editor, typed over in Hex Edit mode, or mutated by the fuzzer, the two
 * models disagree: the wire carries the sender's checksum while a receiver
 * computes a different one and silently drops the packet.
 *
 * Nothing here feeds back into serialization. This reads bytes and spans and
 * reports only the disagreement, so a well-formed packet — where the headers
 * tell the truth — produces no findings at all.
 */
import { getBits, setBits } from './bitio';
import { inet16 } from './checksums';
import { NS } from './bindings';
import type { FieldDef, LayerInstance, ProtocolDefinition, StackInstance } from './model';
import type { Registry } from './registry';
import type { FieldSpan, LayerLayout, SerializedPacket } from './serialize';

export interface ReceiverChecksumFinding {
  /** Index into `stack.layers` of the layer whose checksum is in question. */
  layerIndex: number;
  fieldId: string;
  /** The checksum the packet actually carries. */
  onWire: number;
  /** What a receiver computes; null when the claimed length is impossible. */
  computed: number | null;
  /** The header field that made sender and receiver disagree, in prose. */
  cause: string;
  /** The RFC defining the receiver's pseudo-header, for the issue reference. */
  reference: string;
}

/** Everything the per-layer checks need, gathered once. */
interface Context {
  stack: StackInstance;
  registry: Registry;
  packet: SerializedPacket;
}

/** One transport layer with a pseudo-header checksum, and its enclosing IP. */
interface Site {
  layerIndex: number;
  layer: LayerInstance;
  def: ProtocolDefinition;
  layout: LayerLayout;
  field: FieldDef;
  checksumSpan: FieldSpan;
  ipIndex: number;
  ip: LayerInstance;
  ipDef: ProtocolDefinition;
  ipLayout: LayerLayout;
  isV4: boolean;
}

const IPV6_HEADER_BYTES = 40;

export function receiverChecksumFindings(
  stack: StackInstance,
  registry: Registry,
  packet: SerializedPacket,
): ReceiverChecksumFinding[] {
  const ctx: Context = { stack, registry, packet };
  const findings: ReceiverChecksumFinding[] = [];
  for (const site of pseudoHeaderSites(ctx)) {
    const finding = check(ctx, site);
    if (finding) findings.push(finding);
  }
  return findings;
}

/** Every layer carrying a pseudo-header checksum that has an IP layer to read. */
function* pseudoHeaderSites(ctx: Context): Generator<Site> {
  const { stack, registry, packet } = ctx;
  for (const [layerIndex, layer] of stack.layers.entries()) {
    const def = registry.get(layer.protocolId);
    const layout = layoutOf(packet, layer.uid);
    if (!def || !layout) continue;

    for (const field of def.fields) {
      const spec = field.computed;
      if (spec?.kind !== 'checksum' || !spec.pseudoHeader) continue;
      const checksumSpan = spanOf(packet, layer.uid, field.id);
      if (!checksumSpan) continue;

      // The nearest enclosing IP layer, resolved exactly as the serializer does.
      const ipIndex = enclosingIpIndex(stack, layerIndex, spec.pseudoHeader);
      if (ipIndex === -1) continue; // serialize already warns about this
      const ip = stack.layers[ipIndex]!;
      const ipDef = registry.get(ip.protocolId);
      const ipLayout = layoutOf(packet, ip.uid);
      if (!ipDef || !ipLayout) continue;

      yield {
        layerIndex, layer, def, layout, field, checksumSpan,
        ipIndex, ip, ipDef, ipLayout,
        isV4: ipDef.id === 'ipv4',
      };
    }
  }
}

/** Compare the sender's pseudo-header inputs with the receiver's. */
function check(ctx: Context, site: Site): ReceiverChecksumFinding | null {
  const { packet } = ctx;
  const spec = site.field.computed;
  if (spec?.kind !== 'checksum') return null;

  const onWire = numberAt(packet, site.checksumSpan);
  // RFC 768: a zero UDP checksum over IPv4 means "not computed", and a receiver
  // skips verification entirely. There is nothing to disagree about.
  if (spec.zeroSubstitute && site.isV4 && onWire === 0) return null;

  const senderLength = packet.bytes.length - site.layout.byteOffset;
  const length = receiverLength(ctx, site, spec.receiverLengthField);
  const proto = receiverProto(ctx, site);
  if (!length || !proto) return null;

  // What the sender used: this protocol's own IP-proto claim, or — when it has
  // none — the very field the receiver reads, in which case they cannot differ.
  const senderProto =
    site.def.encapsulations.find(
      (claim) => claim.namespaceId === NS.ipProto && claim.value !== undefined,
    )?.value ?? null;

  const lengthDiffers = length.value !== senderLength;
  const protoDiffers = senderProto !== null && proto.value !== senderProto;
  // A well-formed packet agrees on both, which is the overwhelmingly common
  // case: say nothing rather than restating a checksum the serializer already
  // reports on when it is pinned.
  if (!lengthDiffers && !protoDiffers) return null;

  const causes: string[] = [];
  if (lengthDiffers)
    causes.push(
      `${length.owner} ${length.fieldName} makes the ${site.def.name} segment ${length.value} bytes, but ${senderLength} are on the wire`,
    );
  if (protoDiffers)
    causes.push(
      `${proto.owner} ${proto.fieldName} says ${proto.value}, but ${site.def.name} is protocol ${senderProto}`,
    );

  const base = {
    layerIndex: site.layerIndex,
    fieldId: site.field.id,
    onWire,
    cause: causes.join(', and '),
    reference: site.isV4 ? 'RFC 9293 §3.1 (TCP) / RFC 768 (UDP)' : 'RFC 8200 §8.1',
  };

  // A claimed length shorter than the headers themselves is not a checksum a
  // receiver ever gets to compute — it drops the segment before that.
  if (length.value < 0) return { ...base, computed: null };

  const pseudo = pseudoHeader({
    isV4: site.isV4,
    src: bytesOfField(ctx, site.ip.uid, 'src'),
    dst: finalDestination(ctx, site) ?? bytesOfField(ctx, site.ip.uid, 'dst'),
    length: length.value,
    proto: proto.value,
  });
  if (!pseudo) return null;

  // The same arithmetic the serializer does, over the bytes as they stand:
  // checksum field zeroed, pseudo-header first, then the segment.
  const segment = packet.bytes.slice(site.layout.byteOffset);
  setBits(
    segment,
    site.checksumSpan.bitOffset - site.layout.byteOffset * 8,
    site.checksumSpan.bitLength,
    0,
  );
  let computed = inet16(pseudo, segment);
  if (spec.zeroSubstitute && computed === 0) computed = 0xffff;

  // The inputs diverged but the result did not — nothing a receiver notices.
  if (computed === onWire) return null;
  return { ...base, computed };
}

/**
 * How long a receiver thinks this segment is. UDP carries its own Length
 * (RFC 768); everything else is the IP header's length field minus whatever
 * sits between that header and this one, which covers IPv4 options, IPsec AH
 * and IPv6 extension headers without special cases.
 */
function receiverLength(
  ctx: Context,
  site: Site,
  ownFieldId: string | undefined,
): { value: number; fieldName: string; owner: string } | null {
  if (ownFieldId) {
    const span = spanOf(ctx.packet, site.layer.uid, ownFieldId);
    const field = fieldOf(site.def, ownFieldId);
    if (!span || !field) return null;
    return { value: numberAt(ctx.packet, span), fieldName: field.name, owner: site.def.name };
  }

  const fieldId = site.isV4 ? 'totalLength' : 'payloadLength';
  const span = spanOf(ctx.packet, site.ip.uid, fieldId);
  const field = fieldOf(site.ipDef, fieldId);
  if (!span || !field) return null;
  // IPv6's Payload Length already excludes its 40-byte fixed header.
  const fixedHeader = site.isV4 ? 0 : IPV6_HEADER_BYTES;
  const between = site.layout.byteOffset - site.ipLayout.byteOffset - fixedHeader;
  return { value: numberAt(ctx.packet, span) - between, fieldName: field.name, owner: site.ipDef.name };
}

/**
 * The protocol number a receiver dispatched on to reach this layer: the Next
 * Header of whatever header immediately precedes it, falling back to the IP
 * header's own Protocol / Next Header field.
 */
function receiverProto(
  ctx: Context,
  site: Site,
): { value: number; fieldName: string; owner: string } | null {
  if (site.layerIndex - 1 > site.ipIndex) {
    const previous = ctx.stack.layers[site.layerIndex - 1]!;
    const previousDef = ctx.registry.get(previous.protocolId);
    const span = spanOf(ctx.packet, previous.uid, 'nextHeader');
    const field = previousDef && fieldOf(previousDef, 'nextHeader');
    if (span && field && previousDef)
      return { value: numberAt(ctx.packet, span), fieldName: field.name, owner: previousDef.name };
  }

  const fieldId = site.isV4 ? 'protocol' : 'nextHeader';
  const span = spanOf(ctx.packet, site.ip.uid, fieldId);
  const field = fieldOf(site.ipDef, fieldId);
  if (!span || !field) return null;
  return { value: numberAt(ctx.packet, span), fieldName: field.name, owner: site.ipDef.name };
}

/**
 * RFC 8200 §8.1: while a Routing header still has segments left, the
 * upper-layer checksum uses the packet's final destination rather than the
 * address currently in the IPv6 header. Mirrors the serializer.
 */
function finalDestination(ctx: Context, site: Site): Uint8Array | null {
  for (let j = site.layerIndex - 1; j > site.ipIndex; j--) {
    const candidate = ctx.stack.layers[j]!;
    if (candidate.protocolId !== 'ipv6-routing') continue;
    const left = spanOf(ctx.packet, candidate.uid, 'segmentsLeft');
    if (!left || numberAt(ctx.packet, left) === 0) return null;
    return bytesOfField(ctx, candidate.uid, 'segment0');
  }
  return null;
}

function pseudoHeader(input: {
  isV4: boolean;
  src: Uint8Array | null;
  dst: Uint8Array | null;
  length: number;
  proto: number;
}): Uint8Array | null {
  const { isV4, src, dst, length, proto } = input;
  if (!src || !dst) return null;
  if (isV4) {
    const pseudo = new Uint8Array(12);
    pseudo.set(src, 0);
    pseudo.set(dst, 4);
    pseudo[9] = proto;
    pseudo[10] = (length >> 8) & 0xff;
    pseudo[11] = length & 0xff;
    return pseudo;
  }
  const pseudo = new Uint8Array(40);
  pseudo.set(src, 0);
  pseudo.set(dst, 16);
  pseudo[32] = (length >>> 24) & 0xff;
  pseudo[33] = (length >>> 16) & 0xff;
  pseudo[34] = (length >>> 8) & 0xff;
  pseudo[35] = length & 0xff;
  pseudo[39] = proto;
  return pseudo;
}

function enclosingIpIndex(
  stack: StackInstance,
  from: number,
  kind: 'ipv4' | 'ipv6' | 'auto',
): number {
  for (let j = from - 1; j >= 0; j--) {
    const id = stack.layers[j]!.protocolId;
    const wanted =
      kind === 'auto' ? id === 'ipv4' || id === 'ipv6' : id === kind;
    if (wanted) return j;
  }
  return -1;
}

const layoutOf = (packet: SerializedPacket, uid: string): LayerLayout | undefined =>
  packet.layers.find((layout) => layout.uid === uid);

const spanOf = (packet: SerializedPacket, uid: string, fieldId: string): FieldSpan | undefined =>
  packet.spans.find((span) => span.layerUid === uid && span.fieldId === fieldId);

const numberAt = (packet: SerializedPacket, span: FieldSpan): number =>
  Number(getBits(packet.bytes, span.bitOffset, span.bitLength));

const fieldOf = (def: ProtocolDefinition, fieldId: string): FieldDef | undefined =>
  def.fields.find((field) => field.id === fieldId);

function bytesOfField(ctx: Context, uid: string, fieldId: string): Uint8Array | null {
  const span = spanOf(ctx.packet, uid, fieldId);
  if (!span) return null;
  return ctx.packet.bytes.slice(span.bitOffset / 8, (span.bitOffset + span.bitLength) / 8);
}
