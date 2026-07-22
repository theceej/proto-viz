/**
 * Guided "break this packet" experiments: one-click mutations that introduce a
 * common wire-format error so a learner can see the resulting diagnostic.
 *
 * Every experiment reuses the existing machinery — it pins exactly one computed
 * field to a deliberately wrong value, which the serializer or validator
 * already flags. Nothing here mutates state: an experiment reports the single
 * field to pin, and the UI applies it through the normal pin action (so undo
 * restores the exact previous packet) and shows the explanation.
 */
import type { FieldValue, StackInstance } from './model';
import type { Registry } from './registry';
import type { SerializedPacket } from './serialize';
import { resolveBinding } from './bindings';
import { valueToNumber } from './values';

export interface ExperimentApplication {
  experimentId: string;
  /** Short menu label. */
  title: string;
  /** The single field this experiment pins — nothing else changes. */
  layerUid: string;
  layerName: string;
  fieldId: string;
  fieldName: string;
  /** The deliberately-wrong value to pin. */
  value: FieldValue;
  /** What the mutation does and the diagnostic to watch for, for the UI banner. */
  explanation: string;
}

const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`;

/** Find a field's layer + current (correct) value for the first matching layer. */
function locate(
  stack: StackInstance,
  registry: Registry,
  packet: SerializedPacket,
  protocolId: string,
  fieldId: string,
) {
  for (const layer of stack.layers) {
    if (layer.protocolId !== protocolId) continue;
    const def = registry.get(protocolId);
    const field = def?.fields.find((f) => f.id === fieldId);
    const span = packet.spans.find((s) => s.layerUid === layer.uid && s.fieldId === fieldId);
    if (def && field && span) {
      return { layerUid: layer.uid, def, field, current: valueToNumber(field, span.value) };
    }
  }
  return null;
}

type Builder = (
  stack: StackInstance,
  registry: Registry,
  packet: SerializedPacket,
) => Omit<ExperimentApplication, 'experimentId' | 'title'> | null;

/** Corrupt a checksum by flipping every bit, so it can never match the payload. */
function checksumExperiment(protocolId: string, fieldId: string): Builder {
  return (stack, registry, packet) => {
    const hit = locate(stack, registry, packet, protocolId, fieldId);
    if (!hit) return null;
    const value = (hit.current ^ 0xffff) & 0xffff;
    return {
      layerUid: hit.layerUid,
      layerName: hit.def.name,
      fieldId,
      fieldName: hit.field.name,
      value,
      explanation: `Pinned ${hit.def.name} ${hit.field.name} to ${hex(value)} — the correct value is ${hex(hit.current)}. Look for a checksum-mismatch warning below; a real receiver silently drops the packet.`,
    };
  };
}

/** Overstate a length field so it claims more bytes than the packet contains. */
function lengthExperiment(protocolId: string, fieldId: string, extra: number): Builder {
  return (stack, registry, packet) => {
    const hit = locate(stack, registry, packet, protocolId, fieldId);
    if (!hit) return null;
    const value = hit.current + extra;
    return {
      layerUid: hit.layerUid,
      layerName: hit.def.name,
      fieldId,
      fieldName: hit.field.name,
      value,
      explanation: `Pinned ${hit.def.name} ${hit.field.name} to ${value}, ${extra} more than the real ${hit.current}. Expect a "pinned … but would be" warning; a dissector reads past the true end of the data.`,
    };
  };
}

/** Set a header-length field below its legal minimum (5 words). */
function headerLengthExperiment(protocolId: string, fieldId: string): Builder {
  return (stack, registry, packet) => {
    const hit = locate(stack, registry, packet, protocolId, fieldId);
    if (!hit) return null;
    const value = 4; // legal minimum is 5 (20 bytes); 4 underruns the header.
    return {
      layerUid: hit.layerUid,
      layerName: hit.def.name,
      fieldId,
      fieldName: hit.field.name,
      value,
      explanation: `Pinned ${hit.def.name} ${hit.field.name} to ${value} words — below the 5-word (20-byte) minimum, so the header is truncated. Expect a mismatch warning; a parser would misread every field after it.`,
    };
  };
}

/** Pin an outer selector so it no longer names the protocol that follows. */
const selectorExperiment: Builder = (stack, registry, packet) => {
  for (let i = 0; i < stack.layers.length - 1; i++) {
    const outer = registry.get(stack.layers[i]!.protocolId);
    const inner = registry.get(stack.layers[i + 1]!.protocolId);
    if (!outer || !inner) continue;
    const binding = resolveBinding(outer, inner);
    const selectorId = binding?.namespace.selectorFieldId;
    if (!binding || selectorId == null || binding.claim.value === undefined) continue;
    const field = outer.fields.find((f) => f.id === selectorId);
    const layerUid = stack.layers[i]!.uid;
    const span = packet.spans.find((s) => s.layerUid === layerUid && s.fieldId === selectorId);
    if (!field || !span) continue;

    const claim = binding.claim.value;
    const mask = claim > 0xff ? 0xffff : 0xff;
    const value = (claim ^ 0x0f0f) & mask;
    return {
      layerUid,
      layerName: outer.name,
      fieldId: selectorId,
      fieldName: field.name,
      value,
      explanation: `Pinned ${outer.name} ${field.name} to ${hex(value)}, which no longer selects ${inner.name} (${hex(claim)}). Validation flags a selector mismatch; a receiver would hand the payload to the wrong dissector.`,
    };
  }
  return null;
};

interface ExperimentDef {
  id: string;
  title: string;
  build: Builder;
}

const EXPERIMENTS: ExperimentDef[] = [
  {
    id: 'ipv4-checksum',
    title: 'Corrupt the IPv4 header checksum',
    build: checksumExperiment('ipv4', 'headerChecksum'),
  },
  {
    id: 'tcp-checksum',
    title: 'Corrupt the TCP checksum',
    build: checksumExperiment('tcp', 'checksum'),
  },
  {
    id: 'udp-checksum',
    title: 'Corrupt the UDP checksum',
    build: checksumExperiment('udp', 'checksum'),
  },
  {
    id: 'ipv4-total-length',
    title: 'Overstate the IPv4 total length',
    build: lengthExperiment('ipv4', 'totalLength', 20),
  },
  {
    id: 'udp-length',
    title: 'Overstate the UDP length',
    build: lengthExperiment('udp', 'length', 8),
  },
  {
    id: 'ipv4-ihl',
    title: 'Set an invalid IPv4 IHL',
    build: headerLengthExperiment('ipv4', 'ihl'),
  },
  {
    id: 'tcp-data-offset',
    title: 'Set an invalid TCP data offset',
    build: headerLengthExperiment('tcp', 'dataOffset'),
  },
  {
    id: 'selector-conflict',
    title: 'Point a selector at the wrong protocol',
    build: selectorExperiment,
  },
];

/** Experiments applicable to the current packet, ready to apply. */
export function applicableExperiments(
  stack: StackInstance,
  registry: Registry,
  packet: SerializedPacket,
): ExperimentApplication[] {
  const out: ExperimentApplication[] = [];
  for (const experiment of EXPERIMENTS) {
    const partial = experiment.build(stack, registry, packet);
    if (partial) out.push({ experimentId: experiment.id, title: experiment.title, ...partial });
  }
  return out;
}
