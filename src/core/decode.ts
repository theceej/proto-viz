/**
 * Span-driven field reader: the inverse of serialization for a known layout.
 * Used by round-trip tests (and future paste-hex features) to prove that
 * what was written at each span decodes back to the same value.
 */
import type { FieldDef, FieldValue } from './model';
import type { FieldSpan, SerializedPacket } from './serialize';
import { getBits, getBytes } from './bitio';
import { decodeDnsName, formatIPv4, formatIPv6, formatMac } from './values';

export function readSpanValue(
  bytes: Uint8Array,
  span: FieldSpan,
  field: FieldDef,
): FieldValue {
  switch (field.type) {
    case 'uint':
    case 'flags': {
      const v = getBits(bytes, span.bitOffset, span.bitLength);
      return span.bitLength > 32 ? v : Number(v);
    }
    case 'bytes':
      return getBytes(bytes, span.bitOffset, span.bitLength);
    case 'mac':
      return formatMac(getBytes(bytes, span.bitOffset, span.bitLength));
    case 'ipv4':
      return formatIPv4(getBytes(bytes, span.bitOffset, span.bitLength));
    case 'ipv6':
      return formatIPv6(getBytes(bytes, span.bitOffset, span.bitLength));
    case 'string':
      return new TextDecoder().decode(getBytes(bytes, span.bitOffset, span.bitLength));
    case 'dnsName':
      return decodeDnsName(getBytes(bytes, span.bitOffset, span.bitLength));
  }
}

export interface DecodedField {
  layerUid: string;
  fieldId: string;
  value: FieldValue;
}

/** Decode every span of a serialized packet back into field values. */
export function decodePacket(
  packet: SerializedPacket,
  fieldOf: (layerUid: string, fieldId: string) => FieldDef | undefined,
): DecodedField[] {
  const out: DecodedField[] = [];
  for (const span of packet.spans) {
    const field = fieldOf(span.layerUid, span.fieldId);
    if (!field) continue;
    out.push({
      layerUid: span.layerUid,
      fieldId: span.fieldId,
      value: readSpanValue(packet.bytes, span, field),
    });
  }
  return out;
}
