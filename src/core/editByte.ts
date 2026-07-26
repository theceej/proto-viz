/**
 * Hex-view byte editing: the inverse of the field editor. Given a single-byte
 * change to a serialized packet, work out which field(s) that byte belongs to
 * and fold the new value back into the stack's overrides.
 *
 * The layer structure is left untouched — this reads the affected field spans
 * out of the edited bytes, exactly as the paste-hex decoder reads a layer, and
 * pins any computed field it overwrites (a hand-edited checksum, length, or
 * selector) so the deliberate bytes survive re-serialization. Fields whose bits
 * the edit didn't actually touch are left alone, so editing one nibble of a
 * bit-packed byte doesn't disturb the field sharing the other nibble.
 *
 * Length is never changed: an edit outside the packet, or one that only rewrites
 * a byte to its current value, returns null (no-op).
 */
import type { FieldValue, LayerInstance, StackInstance } from './model';
import type { FieldSpan, SerializedPacket } from './serialize';
import type { Registry } from './registry';
import { readSpanValue } from './decode';

export interface ByteEditResult {
  layers: LayerInstance[];
  trailingPayload: Uint8Array;
}

/** Value equality across the FieldValue union (byte fields compare elementwise). */
function sameFieldValue(a: FieldValue, b: FieldValue): boolean {
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  return a === b;
}

const cloneLayer = (layer: LayerInstance): LayerInstance => ({
  ...layer,
  overrides: { ...layer.overrides },
  pinned: [...layer.pinned],
});

/**
 * Apply a single-byte edit and return the new stack layers and payload, or
 * null when the edit is out of range, not a byte, or a no-op.
 */
export function applyByteEdit(
  stack: StackInstance,
  packet: SerializedPacket,
  registry: Registry,
  byteOffset: number,
  newValue: number,
): ByteEditResult | null {
  return applyByteEdits(stack, packet, registry, new Map([[byteOffset, newValue]]));
}

/**
 * The same fold-back for many bytes at once, which is what the fuzzer needs:
 * a mutation run rewrites bytes all over the packet, and applying them one at
 * a time would re-read each field against bytes that later edits then change.
 * Reading every affected field once, from the fully edited buffer, is both
 * correct and the behaviour a single edit already had.
 *
 * `edits` maps byte offset to new value. Out-of-range or non-byte entries are
 * ignored; null comes back only when nothing ends up changing.
 */
export function applyByteEdits(
  stack: StackInstance,
  packet: SerializedPacket,
  registry: Registry,
  edits: Map<number, number>,
): ByteEditResult | null {
  const edited = new Uint8Array(packet.bytes);
  const applied: number[] = [];
  for (const [byteOffset, newValue] of edits) {
    if (!Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset >= packet.bytes.length) continue;
    if (!Number.isInteger(newValue) || newValue < 0 || newValue > 0xff) continue;
    if (packet.bytes[byteOffset] === newValue) continue;
    edited[byteOffset] = newValue;
    applied.push(byteOffset);
  }
  if (applied.length === 0) return null;

  const payload = stack.trailingPayload ?? new Uint8Array(0);
  const layers = stack.layers.map(cloneLayer);
  const byUid = new Map(layers.map((l) => [l.uid, l]));
  const trailingPayload = new Uint8Array(payload);
  let changed = false;

  // Every field span any edited byte touches, read once against the final
  // buffer. A span covering two edited bytes is therefore handled once, not
  // twice with an intermediate value in between.
  const touched = new Set<FieldSpan>();
  for (const span of packet.spans) {
    if (span.bitLength === 0) continue;
    const first = Math.floor(span.bitOffset / 8);
    const last = Math.floor((span.bitOffset + span.bitLength - 1) / 8);
    if (applied.some((offset) => offset >= first && offset <= last)) touched.add(span);
  }

  for (const span of touched) {
    const layer = byUid.get(span.layerUid);
    const field = layer && registry.get(layer.protocolId)?.fields.find((f) => f.id === span.fieldId);
    if (!layer || !field) continue;
    const before = readSpanValue(packet.bytes, span, field);
    const after = readSpanValue(edited, span, field);
    if (sameFieldValue(before, after)) continue; // this field's bits are unchanged
    layer.overrides[span.fieldId] = after;
    if (span.computed && !layer.pinned.includes(span.fieldId)) layer.pinned.push(span.fieldId);
    changed = true;
  }

  // Bytes no field owns belong to the trailing payload.
  for (const byteOffset of applied) {
    const ownedByField = [...touched].some((span) => {
      const first = Math.floor(span.bitOffset / 8);
      const last = Math.floor((span.bitOffset + span.bitLength - 1) / 8);
      return byteOffset >= first && byteOffset <= last;
    });
    if (ownedByField || byteOffset < packet.payloadOffset) continue;
    const index = byteOffset - packet.payloadOffset;
    if (index >= trailingPayload.length) continue;
    trailingPayload[index] = edited[byteOffset]!;
    changed = true;
  }

  return changed ? { layers, trailingPayload } : null;
}
