/**
 * Wire-bytes → stack decoder: the inverse of `serializeStack` for unknown
 * input. Starting from a chosen outermost protocol, each layer's header is
 * read field-by-field (mirroring the serializer's layout rules), then the
 * layer's binding namespaces identify the next protocol — the same claim
 * tables that validate stacks drive identification in reverse.
 *
 * Fidelity: after identification the decoded stack is re-serialized and
 * compared with the input. Computed fields that don't reproduce the wire
 * value (a wrong checksum, an unknown EtherType) are pinned to the wire
 * value, so loading the result preserves the exact bytes and the field
 * editor's existing "pinned but correct value is X" warnings point at
 * anything anomalous.
 *
 * Limits (each surfaced as a note, never a silent guess):
 * - A layer whose header can't be sized from the wire (free-form text
 *   protocols, multiple value-length fields) is left undecoded; its bytes
 *   become payload.
 * - Opaque namespaces are followed only when exactly one protocol claims
 *   them (VXLAN → Ethernet). Several claimants (an ICMP quoted datagram,
 *   a TLS fragment) mean the content is a guess, so it stays payload.
 * - Compressed DNS names (pointer labels) are not decoded.
 */
import type { Expr, FieldValue, ProtocolDefinition, StackInstance } from './model';
import type { Registry } from './registry';
import { evalExpr, type ExprContext } from './expr';
import { readSpanValue } from './decode';
import { serializeStack, type FieldSpan } from './serialize';
import { getBits } from './bitio';
import { valueToNumber } from './values';
import { newLayer } from './model';

export class HexInputError extends Error {}

/** Max layers a decode will walk; a backstop against claim cycles. */
const MAX_LAYERS = 64;

/**
 * Parse user-pasted hex: bare digit pairs with any mix of whitespace,
 * `0x` prefixes, colons, dashes, commas, or periods between them. This
 * accepts our own hex-copy output and Wireshark's "copy as hex stream",
 * but not full hex dumps with offset/ASCII columns.
 */
export function parseHexInput(text: string): Uint8Array {
  const cleaned = text.replace(/0x/gi, '').replace(/[\s:,.-]+/g, '');
  if (cleaned.length === 0) throw new HexInputError('no hex digits found');
  const bad = cleaned.match(/[^0-9a-fA-F]/);
  if (bad) {
    throw new HexInputError(
      `"${bad[0]}" is not a hex digit — paste plain hex, optionally separated by spaces or colons`,
    );
  }
  if (cleaned.length % 2 !== 0) {
    throw new HexInputError(
      `odd number of hex digits (${cleaned.length}) — bytes need two digits each`,
    );
  }
  const out = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export interface DecodedLayer {
  protocolId: string;
  overrides: Record<string, FieldValue>;
  pinned: string[];
}

export interface DecodedStack {
  layers: DecodedLayer[];
  payload: Uint8Array;
  notes: string[];
  /** True when re-serializing the result reproduces the input byte-for-byte. */
  exact: boolean;
}

interface LayerReadResult {
  headerBytes: number;
  overrides: Record<string, FieldValue>;
  /** Wire value of every present field (computed ones included). */
  values: Map<string, FieldValue>;
}

class LayerDecodeError extends Error {}

/**
 * Decode `bytes` into a stack, treating the outermost layer as
 * `startProtocolId`. Never throws for undecodable content — decoding stops
 * at the last layer it could read with confidence and the rest becomes
 * payload, with notes explaining why.
 */
export function decodeStackBytes(
  bytes: Uint8Array,
  registry: Registry,
  startProtocolId: string,
): DecodedStack {
  const notes: string[] = [];
  const layers: DecodedLayer[] = [];
  let offset = 0;
  let def = registry.get(startProtocolId);
  if (!def) throw new Error(`unknown protocol "${startProtocolId}"`);

  while (def && layers.length < MAX_LAYERS) {
    let read: LayerReadResult;
    try {
      read = readLayer(def, bytes, offset, registry);
    } catch (e) {
      const why = e instanceof LayerDecodeError ? e.message : (e as Error).message;
      notes.push(
        layers.length === 0
          ? `could not decode ${def.name}: ${why}`
          : `stopped before ${def.name}: ${why} — remaining bytes kept as payload`,
      );
      break;
    }
    layers.push({ protocolId: def.id, overrides: read.overrides, pinned: [] });
    offset += read.headerBytes;
    if (offset >= bytes.length) break;
    if (read.headerBytes === 0) {
      notes.push(`${def.name} consumed no bytes; stopping`);
      break;
    }
    def = nextProtocol(def, read.values, registry, notes);
  }

  const payload = bytes.slice(offset);
  if (layers.length === 0) return { layers, payload, notes, exact: false };

  const exact = reconcile(bytes, layers, payload, registry, notes);
  return { layers, payload, notes, exact };
}

/** Read one layer's header at byte `offset`, mirroring the layout pass. */
function readLayer(
  def: ProtocolDefinition,
  bytes: Uint8Array,
  offset: number,
  registry: Registry,
): LayerReadResult {
  const values = new Map<string, FieldValue>();
  const overrides: Record<string, FieldValue> = {};
  const endBit = bytes.length * 8;
  let bit = offset * 8;

  // Unlike layout expressions, decode expressions may reference computed
  // fields — everything already read has a definite wire value.
  const ctx: ExprContext = {
    getField: (fieldId) => {
      const f = def.fields.find((x) => x.id === fieldId);
      if (!f || !values.has(fieldId))
        throw new LayerDecodeError(`expression needs field "${fieldId}" before it is read`);
      return valueToNumber(f, values.get(fieldId)!);
    },
    payloadBytes: NaN, // not knowable while the header extent is being found
    headerBytes: NaN,
  };
  const evalLen = (expr: Expr, unit: 'bits' | 'bytes'): number => {
    const n = evalExpr(expr, ctx);
    if (!Number.isFinite(n)) throw new LayerDecodeError('length expression is not decodable');
    return unit === 'bytes' ? n * 8 : n;
  };

  for (let i = 0; i < def.fields.length; i++) {
    const f = def.fields[i]!;
    if (f.presentIf && evalExpr(f.presentIf, ctx) === 0) continue;

    let bitLength: number;
    if (typeof f.bitLength === 'number') {
      bitLength = f.bitLength;
    } else if (f.bitLength !== 'auto') {
      bitLength = evalLen(f.bitLength.expr, f.bitLength.unit);
    } else if (f.decodeBitLength) {
      bitLength = evalLen(f.decodeBitLength.expr, f.decodeBitLength.unit);
    } else if (f.type === 'dnsName') {
      bitLength = dnsNameBits(bytes, bit, endBit);
    } else {
      bitLength = tailRemainderBits(def, i, bit, endBit, ctx, values, registry);
    }

    if (bitLength < 0) throw new LayerDecodeError(`negative length for "${f.name}"`);
    if (bit + bitLength > endBit)
      throw new LayerDecodeError(`input ends inside "${f.name}" (packet truncated?)`);

    if (bitLength === 0) {
      // The layout pass drops zero-length fields; an explicit empty value
      // round-trips for byte-typed fields, others need no entry at all.
      if (f.type === 'bytes' && !f.computed) overrides[f.id] = new Uint8Array(0);
      if (f.type === 'string' && !f.computed) overrides[f.id] = '';
      continue;
    }
    const value = readSpanValue(bytes, spanAt(bit, bitLength), f);
    values.set(f.id, value);
    if (!f.computed) overrides[f.id] = value;
    bit += bitLength;
  }

  const headerBits = bit - offset * 8;
  if (headerBits % 8 !== 0)
    throw new LayerDecodeError(`header came to ${headerBits} bits, not whole bytes`);
  return { headerBytes: headerBits / 8, overrides, values };
}

const spanAt = (bitOffset: number, bitLength: number): FieldSpan => ({
  layerUid: '',
  fieldId: '',
  bitOffset,
  bitLength,
  value: 0,
  computed: false,
  pinned: false,
});

/** Length in bits of a wire-format DNS name starting at `bit` (byte-aligned). */
function dnsNameBits(bytes: Uint8Array, bit: number, endBit: number): number {
  if (bit % 8 !== 0) throw new LayerDecodeError('DNS name is not byte-aligned');
  const start = bit / 8;
  let i = start;
  while (i * 8 < endBit) {
    const len = bytes[i]!;
    if (len === 0) return (i + 1 - start) * 8;
    if (len >= 0xc0) throw new LayerDecodeError('compressed DNS names are not supported');
    i += 1 + len;
  }
  throw new LayerDecodeError('DNS name runs past the end of the input');
}

/**
 * Size a value-length (`'auto'`) field with no decode rule: it may take
 * "everything left" — but only when nothing structured can follow. All
 * later fields of the layer must have wire-determined sizes, and the layer
 * must be terminal (its namespaces select nothing further), otherwise the
 * header/payload split would be a guess.
 */
function tailRemainderBits(
  def: ProtocolDefinition,
  index: number,
  bit: number,
  endBit: number,
  ctx: ExprContext,
  values: Map<string, FieldValue>,
  registry: Registry,
): number {
  const field = def.fields[index]!;
  let trailingBits = 0;
  for (let j = index + 1; j < def.fields.length; j++) {
    const g = def.fields[j]!;
    if (g.presentIf && evalExpr(g.presentIf, ctx) === 0) continue;
    if (typeof g.bitLength === 'number') trailingBits += g.bitLength;
    else if (g.bitLength !== 'auto')
      trailingBits += evalExpr(g.bitLength.expr, ctx) * (g.bitLength.unit === 'bytes' ? 8 : 1);
    else
      throw new LayerDecodeError(
        `cannot size "${field.name}" — "${g.name}" after it also has a value-derived length`,
      );
  }
  if (nextProtocol(def, values, registry, []) !== undefined)
    throw new LayerDecodeError(
      `cannot size "${field.name}" — ${def.name} selects a payload protocol, so the header end is ambiguous`,
    );
  const remaining = endBit - bit - trailingBits;
  if (remaining < 0)
    throw new LayerDecodeError(`input ends inside "${field.name}" (packet truncated?)`);
  if (remaining % 8 !== 0)
    throw new LayerDecodeError(`"${field.name}" would be a fractional byte count`);
  return remaining;
}

/**
 * Identify the protocol following `def`, from its provided namespaces and
 * the registry's encapsulation claims. `undefined` means decoding stops
 * here (nothing matched, or the match would be a guess).
 */
function nextProtocol(
  def: ProtocolDefinition,
  values: Map<string, FieldValue>,
  registry: Registry,
  notes: string[],
): ProtocolDefinition | undefined {
  const all = registry.all();
  for (const ns of def.providesNamespaces) {
    if (ns.selectorFieldId !== null) {
      const selField = def.fields.find((f) => f.id === ns.selectorFieldId);
      if (!selField || !values.has(selField.id)) continue;
      const claimants = (v: number) =>
        all.filter((p) =>
          p.encapsulations.some((c) => c.namespaceId === ns.id && c.value === v),
        );
      const selValue = valueToNumber(selField, values.get(selField.id)!);
      let matches = claimants(selValue);
      // Port namespaces select by destination, which identifies requests
      // but not responses (a DNS answer has source port 53). Fall back to
      // the source port before giving up.
      if (matches.length === 0 && ns.id.endsWith('dstport') && values.has('srcPort')) {
        const srcField = def.fields.find((f) => f.id === 'srcPort')!;
        const src = valueToNumber(srcField, values.get('srcPort')!);
        matches = claimants(src);
        if (matches.length > 0)
          notes.push(`${matches[0]!.name} identified by source port ${src}`);
      }
      if (matches.length > 1)
        notes.push(
          `${ns.displayName} ${selValue} is claimed by ${matches.map((m) => m.name).join(', ')}; assuming ${matches[0]!.name}`,
        );
      if (matches.length > 0) return matches[0];
      notes.push(
        `nothing in the library claims ${ns.displayName} ${selValue}; remaining bytes kept as payload`,
      );
      return undefined;
    }
    // Opaque namespace: follow only a structurally certain carriage.
    const claimants = all.filter((p) =>
      p.encapsulations.some((c) => c.namespaceId === ns.id),
    );
    if (claimants.length === 1) return claimants[0];
    if (claimants.length > 1) {
      notes.push(
        `${def.name} carries its payload opaquely (${ns.displayName}); content kept as raw payload`,
      );
      return undefined;
    }
  }
  return undefined;
}

/**
 * Re-serialize the decoded stack and pin any computed field whose wire
 * value differs (wrong checksums, unclaimed selector values), so the
 * loaded stack reproduces the input exactly. Returns whether it does.
 */
function reconcile(
  input: Uint8Array,
  layers: DecodedLayer[],
  payload: Uint8Array,
  registry: Registry,
  notes: string[],
): boolean {
  const build = (): StackInstance => ({
    layers: layers.map((l) => ({
      ...newLayer(l.protocolId),
      overrides: l.overrides,
      pinned: l.pinned,
    })),
    trailingPayload: payload,
  });

  let packet = serializeStack(build(), registry);
  if (bytesEqual(packet.bytes, input)) return true;
  if (packet.bytes.length !== input.length) {
    notes.push(
      `re-serializing produces ${packet.bytes.length} bytes, input is ${input.length} — the decode is not exact`,
    );
    return false;
  }

  // Layer order and uids match `layers` by construction.
  const layerIndexByUid = new Map(packet.layers.map((l, i) => [l.uid, i]));
  for (const span of packet.spans) {
    if (!span.computed) continue;
    if (getBits(packet.bytes, span.bitOffset, span.bitLength) === getBits(input, span.bitOffset, span.bitLength))
      continue;
    const layer = layers[layerIndexByUid.get(span.layerUid)!]!;
    const fieldDef = registry
      .get(layer.protocolId)!
      .fields.find((f) => f.id === span.fieldId)!;
    layer.overrides[span.fieldId] = readSpanValue(input, span, fieldDef);
    if (!layer.pinned.includes(span.fieldId)) layer.pinned.push(span.fieldId);
  }

  packet = serializeStack(build(), registry);
  const exact = bytesEqual(packet.bytes, input);
  if (!exact) notes.push('some bytes could not be reproduced — the decode is not exact');
  return exact;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
