import type { FieldValue } from './model';
import type { FieldSpan, LayerLayout, SerializedPacket } from './serialize';

export type DifferenceStatus = 'unchanged' | 'changed' | 'added' | 'removed';

export interface ByteRange {
  start: number;
  end: number;
}

export interface FieldComparison {
  key: string;
  fieldId: string;
  status: DifferenceStatus;
  computed: boolean;
  left: FieldSpan | null;
  right: FieldSpan | null;
  leftBytes: ByteRange | null;
  rightBytes: ByteRange | null;
}

export interface LayerComparison {
  key: string;
  protocolId: string;
  status: DifferenceStatus;
  left: LayerLayout | null;
  right: LayerLayout | null;
  fields: FieldComparison[];
}

export interface ByteComparison {
  index: number;
  status: DifferenceStatus;
  left: number | null;
  right: number | null;
  fieldKey: string | null;
}

export interface PacketComparison {
  layers: LayerComparison[];
  bytes: ByteComparison[];
  editableChanges: number;
  computedChanges: number;
}

const rangeFor = (span: FieldSpan): ByteRange => ({
  start: Math.floor(span.bitOffset / 8),
  end: Math.ceil((span.bitOffset + span.bitLength) / 8) - 1,
});

function valuesEqual(left: FieldValue, right: FieldValue): boolean {
  if (left instanceof Uint8Array && right instanceof Uint8Array) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
  return left === right;
}

function keyedLayers(packet: SerializedPacket): Map<string, LayerLayout> {
  const occurrences = new Map<string, number>();
  return new Map(
    packet.layers.map((layer) => {
      const occurrence = occurrences.get(layer.protocolId) ?? 0;
      occurrences.set(layer.protocolId, occurrence + 1);
      return [`${layer.protocolId}:${occurrence}`, layer];
    }),
  );
}

function fieldsFor(packet: SerializedPacket, layer: LayerLayout | null): FieldSpan[] {
  return layer ? packet.spans.filter((span) => span.layerUid === layer.uid) : [];
}

function statusFor(left: FieldSpan | undefined, right: FieldSpan | undefined): DifferenceStatus {
  if (!left) return 'added';
  if (!right) return 'removed';
  return left.bitLength === right.bitLength && valuesEqual(left.value, right.value)
    ? 'unchanged'
    : 'changed';
}

/** Compare two serialized packets by protocol/field identity before comparing bytes. */
export function comparePackets(
  leftPacket: SerializedPacket,
  rightPacket: SerializedPacket,
): PacketComparison {
  const leftLayers = keyedLayers(leftPacket);
  const rightLayers = keyedLayers(rightPacket);
  const layerKeys = [...leftLayers.keys(), ...[...rightLayers.keys()].filter((key) => !leftLayers.has(key))];

  const layers = layerKeys.map<LayerComparison>((key) => {
    const left = leftLayers.get(key) ?? null;
    const right = rightLayers.get(key) ?? null;
    const leftFields = fieldsFor(leftPacket, left);
    const rightFields = fieldsFor(rightPacket, right);
    const leftById = new Map(leftFields.map((span) => [span.fieldId, span]));
    const rightById = new Map(rightFields.map((span) => [span.fieldId, span]));
    const fieldIds = [
      ...leftById.keys(),
      ...[...rightById.keys()].filter((fieldId) => !leftById.has(fieldId)),
    ];
    const fields = fieldIds.map<FieldComparison>((fieldId) => {
      const leftSpan = leftById.get(fieldId);
      const rightSpan = rightById.get(fieldId);
      return {
        key: `${key}:${fieldId}`,
        fieldId,
        status: statusFor(leftSpan, rightSpan),
        computed: Boolean(leftSpan?.computed || rightSpan?.computed),
        left: leftSpan ?? null,
        right: rightSpan ?? null,
        leftBytes: leftSpan ? rangeFor(leftSpan) : null,
        rightBytes: rightSpan ? rangeFor(rightSpan) : null,
      };
    });
    const status: DifferenceStatus = !left
      ? 'added'
      : !right
        ? 'removed'
        : fields.every((field) => field.status === 'unchanged')
          ? 'unchanged'
          : 'changed';
    return { key, protocolId: left?.protocolId ?? right!.protocolId, status, left, right, fields };
  });

  const changedFields = layers.flatMap((layer) => layer.fields).filter((field) => field.status !== 'unchanged');
  const maxBytes = Math.max(leftPacket.bytes.length, rightPacket.bytes.length);
  const bytes = Array.from({ length: maxBytes }, (_, index): ByteComparison => {
    const left = leftPacket.bytes[index] ?? null;
    const right = rightPacket.bytes[index] ?? null;
    const status: DifferenceStatus = left === null ? 'added' : right === null ? 'removed' : left === right ? 'unchanged' : 'changed';
    const field = changedFields.find(
      (candidate) =>
        (candidate.leftBytes && index >= candidate.leftBytes.start && index <= candidate.leftBytes.end) ||
        (candidate.rightBytes && index >= candidate.rightBytes.start && index <= candidate.rightBytes.end),
    );
    return { index, status, left, right, fieldKey: field?.key ?? null };
  });

  return {
    layers,
    bytes,
    editableChanges: changedFields.filter((field) => !field.computed).length,
    computedChanges: changedFields.filter((field) => field.computed).length,
  };
}
