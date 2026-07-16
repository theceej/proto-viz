/**
 * Three-pass stack serializer.
 *
 *  1. Layout (innermost → outermost): resolve field presence and variable
 *     lengths, so every layer's header size — and therefore every field's
 *     absolute bit offset — is known. Plain field values are written;
 *     computed fields get zero placeholders.
 *  2. Values: fill `expr` and `binding` computed fields.
 *  3. Checksums (innermost → outermost): checksums may cover payload bytes
 *     (already final) but never outer layers, so inner-first is correct.
 */
import type {
  FieldDef,
  FieldValue,
  LayerInstance,
  ProtocolDefinition,
  StackInstance,
} from './model';
import type { Registry } from './registry';
import { evalExpr, referencesHeaderBytes, type ExprContext, ExprError } from './expr';
import { setBits, setBytes, getBits } from './bitio';
import { valueToBytes, valueToNumber, zeroValue, ValueError } from './values';
import { inet16, crc32c } from './checksums';
import { resolveBinding } from './bindings';

export interface FieldSpan {
  layerUid: string;
  fieldId: string;
  /** Absolute offsets within the serialized packet. */
  bitOffset: number;
  bitLength: number;
  /** Resolved value after computed passes. */
  value: FieldValue;
  computed: boolean;
  pinned: boolean;
}

export interface LayerLayout {
  uid: string;
  protocolId: string;
  byteOffset: number;
  headerBytes: number;
}

export interface SerializeIssue {
  severity: 'error' | 'warning';
  layerUid: string | null;
  message: string;
}

export interface SerializedPacket {
  bytes: Uint8Array;
  spans: FieldSpan[];
  layers: LayerLayout[];
  /** Byte offset where trailing payload starts (== bytes.length if none). */
  payloadOffset: number;
  issues: SerializeIssue[];
}

interface ResolvedField {
  def: FieldDef;
  bitLength: number;
  /** Pre-compute value: override ?? default ?? zero. */
  value: FieldValue;
  /** Wire bytes for byte-typed fields. */
  bytes: Uint8Array | null;
}

interface WorkLayer {
  instance: LayerInstance;
  def: ProtocolDefinition;
  fields: ResolvedField[];
  headerBytes: number;
  payloadBytes: number;
  byteOffset: number;
  spans: Map<string, FieldSpan>;
}

export class SerializeError extends Error {}

export function serializeStack(stack: StackInstance, registry: Registry): SerializedPacket {
  const issues: SerializeIssue[] = [];
  const trailing = stack.trailingPayload ?? new Uint8Array(0);

  const work: WorkLayer[] = stack.layers.map((instance) => {
    const def = registry.get(instance.protocolId);
    if (!def) throw new SerializeError(`unknown protocol "${instance.protocolId}"`);
    return {
      instance,
      def,
      fields: [],
      headerBytes: 0,
      payloadBytes: 0,
      byteOffset: 0,
      spans: new Map(),
    };
  });

  // ---- Pass 1: layout, innermost → outermost -------------------------------
  let innerBytes = trailing.length;
  for (let i = work.length - 1; i >= 0; i--) {
    const layer = work[i]!;
    layer.payloadBytes = innerBytes;
    layoutLayer(layer, issues);
    innerBytes += layer.headerBytes;
  }

  const totalBytes = innerBytes;
  const buf = new Uint8Array(totalBytes);
  let offset = 0;
  for (const layer of work) {
    layer.byteOffset = offset;
    offset += layer.headerBytes;
  }
  const payloadOffset = offset;
  buf.set(trailing, payloadOffset);

  // Write pass-1 values (computed fields as zero placeholders).
  const spans: FieldSpan[] = [];
  for (const layer of work) {
    let bit = layer.byteOffset * 8;
    for (const rf of layer.fields) {
      const span: FieldSpan = {
        layerUid: layer.instance.uid,
        fieldId: rf.def.id,
        bitOffset: bit,
        bitLength: rf.bitLength,
        value: rf.value,
        computed: rf.def.computed !== undefined,
        pinned: layer.instance.pinned.includes(rf.def.id),
      };
      spans.push(span);
      layer.spans.set(rf.def.id, span);
      try {
        if (rf.bytes !== null) {
          const padded = fitBytes(rf.bytes, rf.bitLength / 8);
          setBytes(buf, bit, padded);
        } else if (!span.computed || span.pinned) {
          setBits(buf, bit, rf.bitLength, valueToNumber(rf.def, rf.value));
        }
      } catch (e) {
        issues.push({
          severity: 'error',
          layerUid: layer.instance.uid,
          message: `${layer.def.name}.${rf.def.name}: ${(e as Error).message}`,
        });
      }
      bit += rf.bitLength;
    }
  }

  // ---- Pass 2: expr + binding computed fields ------------------------------
  for (let i = 0; i < work.length; i++) {
    const layer = work[i]!;
    const next = work[i + 1];
    for (const rf of layer.fields) {
      const spec = rf.def.computed;
      if (!spec || spec.kind === 'checksum') continue;
      const span = layer.spans.get(rf.def.id)!;
      let computedValue: number | undefined;
      try {
        if (spec.kind === 'expr') {
          computedValue = evalExpr(spec.expr, exprCtx(layer));
        } else {
          // binding
          const binding = next ? resolveBinding(layer.def, next.def) : null;
          if (
            binding &&
            binding.namespace.selectorFieldId === rf.def.id &&
            binding.claim.value !== undefined
          ) {
            computedValue = binding.claim.value;
          }
        }
      } catch (e) {
        issues.push({
          severity: 'error',
          layerUid: layer.instance.uid,
          message: `${layer.def.name}.${rf.def.name}: ${(e as Error).message}`,
        });
      }

      if (span.pinned) {
        const pinnedNum = valueToNumber(rf.def, span.value);
        if (computedValue !== undefined && computedValue !== pinnedNum) {
          issues.push({
            severity: 'warning',
            layerUid: layer.instance.uid,
            message: `${layer.def.name}.${rf.def.name} is pinned to ${pinnedNum} but would be ${computedValue}`,
          });
        }
        continue; // pinned value already written in pass 1
      }

      const finalValue =
        computedValue ?? (rf.def.default !== undefined ? valueToNumber(rf.def, rf.def.default) : 0);
      setBits(buf, span.bitOffset, span.bitLength, finalValue);
      span.value = finalValue;
    }
  }

  // ---- Pass 3: checksums, innermost → outermost ----------------------------
  for (let i = work.length - 1; i >= 0; i--) {
    const layer = work[i]!;
    for (const rf of layer.fields) {
      const spec = rf.def.computed;
      if (!spec || spec.kind !== 'checksum') continue;
      const span = layer.spans.get(rf.def.id)!;
      try {
        // Zero the checksum field for computation.
        setBits(buf, span.bitOffset, span.bitLength, 0);
        const start = layer.byteOffset;
        const end = spec.scope === 'header' ? start + layer.headerBytes : buf.length;
        const scopeBytes = buf.subarray(start, end);
        const chunks: Uint8Array[] = [];
        if (spec.pseudoHeader) {
          const pseudo = buildPseudoHeader(work, i, buf, spec.pseudoHeader, issues);
          if (pseudo) chunks.push(pseudo);
        }
        chunks.push(scopeBytes);
        let sum = spec.algorithm === 'inet16' ? inet16(...chunks) : crc32c(...chunks);
        if (spec.zeroSubstitute && sum === 0) sum = 0xffff;

        if (span.pinned) {
          const pinnedNum = valueToNumber(rf.def, span.value);
          setBits(buf, span.bitOffset, span.bitLength, pinnedNum);
          if (pinnedNum !== sum) {
            issues.push({
              severity: 'warning',
              layerUid: layer.instance.uid,
              message: `${layer.def.name}.${rf.def.name} pinned to 0x${pinnedNum.toString(16)} but correct checksum is 0x${sum.toString(16)}`,
            });
          }
        } else {
          setBits(buf, span.bitOffset, span.bitLength, sum);
          span.value = sum;
        }
      } catch (e) {
        issues.push({
          severity: 'error',
          layerUid: layer.instance.uid,
          message: `${layer.def.name}.${rf.def.name}: ${(e as Error).message}`,
        });
      }
    }
  }

  return {
    bytes: buf,
    spans,
    layers: work.map((l) => ({
      uid: l.instance.uid,
      protocolId: l.def.id,
      byteOffset: l.byteOffset,
      headerBytes: l.headerBytes,
    })),
    payloadOffset,
    issues,
  };
}

/** Resolve field presence, lengths, and pre-compute values for one layer. */
function layoutLayer(layer: WorkLayer, issues: SerializeIssue[]): void {
  const { def, instance } = layer;
  const resolved: ResolvedField[] = [];

  const preValue = (f: FieldDef): FieldValue =>
    instance.overrides[f.id] ?? f.default ?? zeroValue(f);

  const ctx: ExprContext = {
    getField: (fieldId) => {
      const f = def.fields.find((x) => x.id === fieldId);
      if (!f) throw new ExprError(`unknown field "${fieldId}"`);
      if (f.computed) throw new ExprError(`layout expression references computed field "${fieldId}"`);
      return valueToNumber(f, preValue(f));
    },
    payloadBytes: layer.payloadBytes,
    headerBytes: 0, // not available during layout
  };

  let totalBits = 0;
  for (const f of def.fields) {
    try {
      if (f.presentIf && evalExpr(f.presentIf, ctx) === 0) continue;

      const value = preValue(f);
      let bytes: Uint8Array | null = null;
      let bitLength: number;

      if (f.bitLength === 'auto') {
        bytes = valueToBytes(f, value);
        if (bytes === null)
          throw new ValueError(`auto length is only valid for byte-typed fields`);
        bitLength = bytes.length * 8;
      } else if (typeof f.bitLength === 'number') {
        bitLength = f.bitLength;
        bytes = valueToBytes(f, value);
      } else {
        if (referencesHeaderBytes(f.bitLength.expr))
          throw new ExprError(`length of "${f.id}" cannot reference headerBytes`);
        const n = evalExpr(f.bitLength.expr, ctx);
        bitLength = f.bitLength.unit === 'bytes' ? n * 8 : n;
        bytes = valueToBytes(f, value);
      }

      if (bitLength < 0) throw new ValueError(`negative length for "${f.id}"`);
      if (bitLength === 0) continue; // zero-length optional field (e.g. empty options)

      if (bytes !== null && bytes.length * 8 !== bitLength) {
        bytes = fitBytes(bytes, bitLength / 8);
      }
      resolved.push({ def: f, bitLength, value, bytes });
      totalBits += bitLength;
    } catch (e) {
      issues.push({
        severity: 'error',
        layerUid: instance.uid,
        message: `${def.name}.${f.name}: ${(e as Error).message}`,
      });
    }
  }

  if (totalBits % 8 !== 0) {
    issues.push({
      severity: 'error',
      layerUid: instance.uid,
      message: `${def.name}: header is ${totalBits} bits, not a whole number of bytes`,
    });
    // Pad up so downstream offsets stay byte-aligned.
    totalBits = Math.ceil(totalBits / 8) * 8;
  }

  layer.fields = resolved;
  layer.headerBytes = totalBits / 8;
}

function exprCtx(layer: WorkLayer): ExprContext {
  return {
    getField: (fieldId) => {
      const rf = layer.fields.find((x) => x.def.id === fieldId);
      if (!rf) throw new ExprError(`unknown field "${fieldId}"`);
      if (rf.def.computed) throw new ExprError(`expression references computed field "${fieldId}"`);
      return valueToNumber(rf.def, rf.value);
    },
    payloadBytes: layer.payloadBytes,
    headerBytes: layer.headerBytes,
  };
}

/** Pad (with trailing zeros) or truncate bytes to exactly `n` bytes. */
function fitBytes(bytes: Uint8Array, n: number): Uint8Array {
  if (!Number.isInteger(n)) throw new ValueError('byte field length is not byte-aligned');
  if (bytes.length === n) return bytes;
  const out = new Uint8Array(n);
  out.set(bytes.subarray(0, n));
  return out;
}

/**
 * Build the IPv4/IPv6 pseudo-header for a transport checksum at layer index
 * `i`, reading addresses and the protocol byte from the nearest enclosing IP
 * layer's already-serialized bytes.
 */
function buildPseudoHeader(
  work: WorkLayer[],
  i: number,
  buf: Uint8Array,
  kind: 'ipv4' | 'ipv6' | 'auto',
  issues: SerializeIssue[],
): Uint8Array | null {
  const layer = work[i]!;
  let ip: WorkLayer | undefined;
  for (let j = i - 1; j >= 0; j--) {
    const id = work[j]!.def.id;
    if ((kind === 'ipv4' || kind === 'auto') && id === 'ipv4') { ip = work[j]; break; }
    if ((kind === 'ipv6' || kind === 'auto') && id === 'ipv6') { ip = work[j]; break; }
  }
  if (!ip) {
    issues.push({
      severity: 'warning',
      layerUid: layer.instance.uid,
      message: `${layer.def.name}: no enclosing IP layer for pseudo-header checksum; computed without it`,
    });
    return null;
  }

  const spanBytes = (fieldId: string): Uint8Array | null => {
    const s = ip.spans.get(fieldId);
    if (!s) return null;
    return buf.slice(s.bitOffset / 8, s.bitOffset / 8 + s.bitLength / 8);
  };

  const segmentLength = buf.length - layer.byteOffset;

  if (ip.def.id === 'ipv4') {
    const src = spanBytes('src');
    const dst = spanBytes('dst');
    const proto = ip.spans.get('protocol');
    if (!src || !dst || !proto) return null;
    const pseudo = new Uint8Array(12);
    pseudo.set(src, 0);
    pseudo.set(dst, 4);
    pseudo[9] = Number(getBits(buf, proto.bitOffset, proto.bitLength));
    pseudo[10] = segmentLength >> 8;
    pseudo[11] = segmentLength & 0xff;
    return pseudo;
  } else {
    const src = spanBytes('src');
    const dst = spanBytes('dst');
    const next = ip.spans.get('nextHeader');
    if (!src || !dst || !next) return null;
    const pseudo = new Uint8Array(40);
    pseudo.set(src, 0);
    pseudo.set(dst, 16);
    pseudo[32] = (segmentLength >>> 24) & 0xff;
    pseudo[33] = (segmentLength >>> 16) & 0xff;
    pseudo[34] = (segmentLength >>> 8) & 0xff;
    pseudo[35] = segmentLength & 0xff;
    pseudo[39] = Number(getBits(buf, next.bitOffset, next.bitLength));
    return pseudo;
  }
}
