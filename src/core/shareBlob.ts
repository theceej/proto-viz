/**
 * Share code v2 payload: the compact "exact packet" blob that rides alongside
 * the structure-only word code as the `?e=` URL parameter.
 *
 * The word code (`share.ts`) stays frozen and human-shareable, carrying only
 * which protocols are stacked. This blob adds the mutable state the word code
 * drops — per-layer field overrides, pinned computed fields, and the trailing
 * payload — as a base64url binary string that is decoded *in the context of*
 * the structure the word code already produced, so it never re-encodes
 * protocol identity.
 *
 * Layout (before base64url), CRC-8 over everything preceding it:
 *
 *   [1B version = 2]
 *   [varint: number of edited layers]
 *     per layer: [1B layer index] [1B field-entry count]
 *       per field: [1B field ordinal in ProtocolDefinition.fields]
 *                  [1B flags: bit0 pinned, bit1 has value]
 *                  [value bytes, iff bit1 — width is implied by the field type]
 *   [varint: payload length] [payload bytes]
 *   [1B CRC-8]
 *
 * Fields are keyed by their ordinal in the protocol definition, which is the
 * wire layout order and therefore as frozen as `SHARE_PROTOCOL_IDS`. Values
 * are self-sized from the field's type/bitLength, so no per-value type tag is
 * needed. mac/ipv4/ipv6 canonicalise on the round-trip (they re-encode to
 * their wire bytes); numeric overrides round-trip exactly.
 */
import type { FieldDef, LayerInstance, StackInstance } from './model';
import { newLayer } from './model';
import type { Registry } from './registry';
import { ShareCodeError, crc8 } from './share';
import {
  formatIPv4,
  formatIPv6,
  formatMac,
  parseIPv4,
  parseIPv6,
  parseMac,
} from './values';

const BLOB_VERSION = 2;

/**
 * Cap the raw blob so `?s=...&e=...` stays comfortably under the ~2 KB many
 * environments impose on URLs (base64url inflates bytes by ~4/3, leaving room
 * for the word code and the rest of the URL).
 */
const MAX_BLOB_BYTES = 1200;

class ByteWriter {
  private readonly bytes: number[] = [];
  u8(n: number): void {
    this.bytes.push(n & 0xff);
  }
  bytesRaw(b: Uint8Array): void {
    for (const x of b) this.bytes.push(x);
  }
  /** Unsigned LEB128. */
  varint(n: number): void {
    let v = n >>> 0;
    do {
      let b = v & 0x7f;
      v >>>= 7;
      if (v !== 0) b |= 0x80;
      this.bytes.push(b);
    } while (v !== 0);
  }
  toArray(): number[] {
    return this.bytes;
  }
}

class ByteReader {
  private pos = 0;
  constructor(private readonly bytes: Uint8Array) {}
  get remaining(): number {
    return this.bytes.length - this.pos;
  }
  u8(): number {
    if (this.pos >= this.bytes.length) throw new ShareCodeError('Share link data is truncated.');
    return this.bytes[this.pos++]!;
  }
  take(n: number): Uint8Array {
    if (this.pos + n > this.bytes.length)
      throw new ShareCodeError('Share link data is truncated.');
    const slice = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }
  varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const b = this.u8();
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 28) throw new ShareCodeError('Share link data is malformed.');
    }
    return result >>> 0;
  }
}

/** Byte width of a fixed-size numeric field. */
function uintWidth(field: FieldDef): number {
  const bits = typeof field.bitLength === 'number' ? field.bitLength : 8;
  return Math.max(1, Math.ceil(bits / 8));
}

function writeValue(writer: ByteWriter, field: FieldDef, value: unknown): void {
  switch (field.type) {
    case 'uint':
    case 'flags': {
      const width = uintWidth(field);
      let v = typeof value === 'bigint' ? value : BigInt(Math.trunc(Number(value)));
      const out = new Uint8Array(width);
      for (let i = width - 1; i >= 0; i--) {
        out[i] = Number(v & 0xffn);
        v >>= 8n;
      }
      writer.bytesRaw(out);
      return;
    }
    case 'mac':
      writer.bytesRaw(parseMac(String(value)));
      return;
    case 'ipv4':
      writer.bytesRaw(parseIPv4(String(value)));
      return;
    case 'ipv6':
      writer.bytesRaw(parseIPv6(String(value)));
      return;
    case 'bytes': {
      const b = value instanceof Uint8Array ? value : new Uint8Array(0);
      writer.varint(b.length);
      writer.bytesRaw(b);
      return;
    }
    case 'string':
    case 'dnsName': {
      const b = new TextEncoder().encode(String(value));
      writer.varint(b.length);
      writer.bytesRaw(b);
      return;
    }
  }
}

function readValue(reader: ByteReader, field: FieldDef): number | bigint | string | Uint8Array {
  switch (field.type) {
    case 'uint':
    case 'flags': {
      const width = uintWidth(field);
      let v = 0n;
      for (const b of reader.take(width)) v = (v << 8n) | BigInt(b);
      return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
    }
    case 'mac':
      return formatMac(reader.take(6));
    case 'ipv4':
      return formatIPv4(reader.take(4));
    case 'ipv6':
      return formatIPv6(reader.take(16));
    case 'bytes':
      return new Uint8Array(reader.take(reader.varint()));
    case 'string':
    case 'dnsName':
      return new TextDecoder().decode(reader.take(reader.varint()));
  }
}

function toBase64Url(bytes: number[]): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  let bin: string;
  try {
    bin = atob(padded);
  } catch {
    throw new ShareCodeError('Share link data is not valid.');
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Encode a stack's field edits and payload as a base64url blob, or `null` when
 * there is nothing to add beyond the structure (no overrides, no pinned
 * fields, no payload) — the caller can then offer the structure link only.
 * Throws {@link ShareCodeError} when the result would be too large to share.
 */
export function encodePacketBlob(stack: StackInstance, registry: Registry): string | null {
  const payload = stack.trailingPayload ?? new Uint8Array(0);
  const editedLayers: { index: number; entries: { ordinal: number; pinned: boolean; value?: unknown }[] }[] = [];

  stack.layers.forEach((layer, index) => {
    const def = registry.get(layer.protocolId);
    if (!def) return;
    const fieldIds = new Set([...Object.keys(layer.overrides), ...layer.pinned]);
    const entries: { ordinal: number; pinned: boolean; value?: unknown }[] = [];
    for (const fieldId of fieldIds) {
      const ordinal = def.fields.findIndex((f) => f.id === fieldId);
      if (ordinal < 0) continue; // stale key: drop it
      const hasValue = fieldId in layer.overrides;
      entries.push({
        ordinal,
        pinned: layer.pinned.includes(fieldId),
        value: hasValue ? layer.overrides[fieldId] : undefined,
      });
    }
    if (entries.length > 0) editedLayers.push({ index, entries });
  });

  if (editedLayers.length === 0 && payload.length === 0) return null;

  const writer = new ByteWriter();
  writer.u8(BLOB_VERSION);
  writer.varint(editedLayers.length);
  for (const { index, entries } of editedLayers) {
    const def = registry.get(stack.layers[index]!.protocolId)!;
    writer.u8(index);
    writer.u8(entries.length);
    for (const entry of entries) {
      writer.u8(entry.ordinal);
      const hasValue = entry.value !== undefined;
      writer.u8((entry.pinned ? 1 : 0) | (hasValue ? 2 : 0));
      if (hasValue) writeValue(writer, def.fields[entry.ordinal]!, entry.value);
    }
  }
  writer.varint(payload.length);
  writer.bytesRaw(payload);

  const bytes = writer.toArray();
  if (bytes.length + 1 > MAX_BLOB_BYTES) {
    throw new ShareCodeError(
      'This packet’s edits and payload are too large to fit in a shareable link (~2 KB limit). Trim the payload, or share the structure only.',
    );
  }
  bytes.push(crc8(bytes));
  return toBase64Url(bytes);
}

/**
 * Decode a `?e=` blob against the structure the word code already produced,
 * returning fully-populated layers (fresh uids) and the trailing payload.
 * Throws {@link ShareCodeError} on a version, checksum, or structural mismatch.
 */
export function decodePacketBlob(
  blob: string,
  protocolIds: string[],
  registry: Registry,
): { layers: LayerInstance[]; payload: Uint8Array } {
  const bytes = fromBase64Url(blob.trim());
  if (bytes.length < 2) throw new ShareCodeError('Share link data is truncated.');
  const body = bytes.subarray(0, bytes.length - 1);
  if (crc8([...body]) !== bytes[bytes.length - 1])
    throw new ShareCodeError('Share link data failed its checksum — it may be corrupted.');

  const reader = new ByteReader(body);
  if (reader.u8() !== BLOB_VERSION)
    throw new ShareCodeError('This share link was made by a newer version of proto-viz — refresh to update.');

  const layers = protocolIds.map(newLayer);
  const editedCount = reader.varint();
  for (let i = 0; i < editedCount; i++) {
    const layerIndex = reader.u8();
    const layer = layers[layerIndex];
    const def = layer ? registry.get(layer.protocolId) : undefined;
    if (!layer || !def) throw new ShareCodeError('Share link edits do not match the stack.');
    const entryCount = reader.u8();
    for (let j = 0; j < entryCount; j++) {
      const ordinal = reader.u8();
      const flags = reader.u8();
      const field = def.fields[ordinal];
      if (!field) throw new ShareCodeError('Share link edits do not match the stack.');
      if (flags & 2) layer.overrides[field.id] = readValue(reader, field);
      if (flags & 1) layer.pinned.push(field.id);
    }
  }

  const payload = new Uint8Array(reader.take(reader.varint()));
  return { layers, payload };
}
