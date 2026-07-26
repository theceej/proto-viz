import type { BitLength, Expr, FieldDef, ProtocolDefinition } from '../model';

export type DecodeLength =
  | Exclude<BitLength, 'auto'>
  | 'remainder'
  | 'dnsName'
  | { trailingBits: number };

export interface InterpretedField {
  definition: FieldDef;
  index: number;
  /** Absolute MSB-first offset, or null once layout is data-dependent. */
  bitOffset: number | null;
  fixedBitLength: number | null;
  decodeLength: DecodeLength;
}

export interface InterpretedProtocol {
  definition: ProtocolDefinition;
  fields: InterpretedField[];
  fixedBitLength: number | null;
  /** Leading bits whose presence and width do not depend on packet values. */
  fixedPrefixBitLength: number;
  warnings: string[];
}

export function describeExpr(expr: Expr): string {
  switch (expr.kind) {
    case 'const': return String(expr.value);
    case 'field': return expr.fieldId;
    case 'payloadBytes': return 'payloadBytes';
    case 'headerBytes': return 'headerBytes';
    case 'binop': return `(${describeExpr(expr.left)} ${expr.op === 'div' ? '/' : expr.op} ${describeExpr(expr.right)})`;
  }
}

function fixedTrailingBits(fields: FieldDef[], after: number): number | null {
  let bits = 0;
  for (let index = after; index < fields.length; index++) {
    const field = fields[index]!;
    if (field.presentIf || typeof field.bitLength !== 'number') return null;
    bits += field.bitLength;
  }
  return bits;
}

function decodeLength(field: FieldDef, fields: FieldDef[], index: number): DecodeLength {
  if (field.bitLength !== 'auto') return field.bitLength;
  if (field.decodeBitLength) return field.decodeBitLength;
  if (field.type === 'dnsName') return 'dnsName';
  const trailingBits = fixedTrailingBits(fields, index + 1);
  return trailingBits === null || trailingBits === 0 ? 'remainder' : { trailingBits };
}

export function interpretProtocol(definition: ProtocolDefinition): InterpretedProtocol {
  const warnings: string[] = [];
  let offset: number | null = 0;
  let fixedPrefixBitLength: number | null = null;
  const fields = definition.fields.map((field, index): InterpretedField => {
    const length = decodeLength(field, definition.fields, index);
    const fixedBitLength = typeof length === 'number' ? length : null;
    const bitOffset = offset;
    if (field.computed?.kind === 'checksum') warnings.push(`${field.name}: ${field.computed.algorithm} checksum must be validated or recomputed by the caller.`);
    if (field.computed?.kind === 'binding') warnings.push(`${field.name}: payload protocol binding requires application context.`);
    if (field.computed?.kind === 'expr') warnings.push(`${field.name}: computed expression metadata is decoded from the wire; generation does not overwrite it.`);
    if (field.bitLength === 'auto' && !field.decodeBitLength && field.type !== 'dnsName') {
      if (typeof length === 'object' && 'trailingBits' in length) {
        warnings.push(`${field.name}: auto length is approximated as the remaining packet minus ${length.trailingBits} statically sized trailing bits; the payload boundary is unavailable.`);
      } else {
        warnings.push(`${field.name}: auto length is approximated as the remaining packet; trailing layout or payload boundary is unavailable.`);
      }
    }
    if (field.presentIf || fixedBitLength === null) {
      if (fixedPrefixBitLength === null) fixedPrefixBitLength = offset ?? 0;
      offset = null;
    }
    else if (offset !== null) offset += fixedBitLength;
    return { definition: field, index, bitOffset, fixedBitLength, decodeLength: length };
  });
  return {
    definition,
    fields,
    fixedBitLength: offset,
    fixedPrefixBitLength: fixedPrefixBitLength ?? offset ?? 0,
    warnings: [...new Set(warnings)],
  };
}
