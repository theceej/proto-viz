import type { FieldDef, FieldValue, LayerInstance } from '../../../core/model';
import type { Registry } from '../../../core/registry';
import type { SerializedPacket } from '../../../core/serialize';
import { useStackStore } from '../../../store/stackStore';
import { isActive, useHighlightStore } from '../../../store/highlightStore';
import { Lock, LockOpen, RotateCcw } from 'lucide-react';
import ProtocolInfoLink from '../ProtocolInfoLink';
import { layerColor } from '../../colors';
import { bitsLabel, formatFieldValue } from '../../format';
import FieldInput from './FieldInput';
import TcpOptionsInput from './TcpOptionsInput';
import Ipv4OptionsInput from './Ipv4OptionsInput';
import PayloadSection from './PayloadSection';

/**
 * Editable field tree for every layer in the stack, plus the trailing payload.
 * In `readOnly` mode (e.g. inspecting a generated scenario step) every value is
 * shown but not editable, and the payload is read from the packet rather than
 * the store.
 */
export default function FieldEditor({
  layers,
  packet,
  registry,
  readOnly = false,
}: {
  layers: LayerInstance[];
  packet: SerializedPacket | null;
  registry: Registry;
  readOnly?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 p-4">
      {layers.map((layer, i) => (
        <LayerSection
          key={layer.uid}
          layer={layer}
          layerIndex={i}
          packet={packet}
          registry={registry}
          readOnly={readOnly}
        />
      ))}
      {readOnly ? <ReadOnlyPayload packet={packet} /> : <PayloadSection />}
    </div>
  );
}

/** Trailing-payload summary for a fixed packet (no editing). */
function ReadOnlyPayload({ packet }: { packet: SerializedPacket | null }) {
  const bytes = packet ? packet.bytes.slice(packet.payloadOffset) : new Uint8Array();
  if (bytes.length === 0) return null;
  const preview = [...bytes.slice(0, 48)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
  return (
    <section className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40">
      <header className="flex items-center gap-2 border-b border-zinc-800 border-l-3 border-l-zinc-500 px-3 py-2">
        <span className="text-[13px] font-semibold text-zinc-100">Payload</span>
        <span className="font-mono text-[11px] text-zinc-500">{bytes.length} bytes</span>
      </header>
      <div className="px-3 py-2 font-mono text-[12px] break-all text-zinc-400">
        {preview}
        {bytes.length > 48 && ' …'}
      </div>
    </section>
  );
}

function LayerSection({
  layer,
  layerIndex,
  packet,
  registry,
  readOnly,
}: {
  layer: LayerInstance;
  layerIndex: number;
  packet: SerializedPacket | null;
  registry: Registry;
  readOnly: boolean;
}) {
  const def = registry.get(layer.protocolId);
  const color = layerColor(layerIndex);
  if (!def) return null;

  const spansById = new Map(
    (packet?.spans ?? []).filter((s) => s.layerUid === layer.uid).map((s) => [s.fieldId, s]),
  );

  return (
    <section className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40">
      <header
        className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2"
        style={{ borderLeft: `3px solid ${color.accent}` }}
      >
        <span className="text-[13px] font-semibold text-zinc-100">{def.name}</span>
        <ProtocolInfoLink protocolId={def.id} name={def.name} />
        <span className="ml-auto font-mono text-[11px] text-zinc-500">
          {spansById.size > 0 && packet
            ? bitsLabel(
                (packet.layers.find((l) => l.uid === layer.uid)?.headerBytes ?? 0) * 8,
              )
            : ''}
        </span>
      </header>
      <div className="divide-y divide-zinc-800/60">
        {def.fields.map((field) => {
          const span = spansById.get(field.id);
          if (!span && packet && !(['tcp', 'ipv4'].includes(layer.protocolId) && field.id === 'options'))
            return null; // presentIf-hidden or zero-length (TCP/IPv4 options remain addable)
          return (
            <FieldRow
              key={field.id}
              layer={layer}
              field={field}
              value={span?.value ?? layer.overrides[field.id] ?? field.default}
              registry={registry}
              readOnly={readOnly}
            />
          );
        })}
      </div>
    </section>
  );
}

function FieldRow({
  layer,
  field,
  value,
  registry,
  readOnly,
}: {
  layer: LayerInstance;
  field: FieldDef;
  value: FieldValue | undefined;
  registry: Registry;
  readOnly: boolean;
}) {
  const { setHovered, toggleLocked } = useHighlightStore();
  const hovered = useHighlightStore((s) => s.hovered);
  const locked = useHighlightStore((s) => s.locked);
  const { setOverride, clearOverride, pinField, unpinField } = useStackStore();

  const active =
    isActive(hovered, layer.uid, field.id) || isActive(locked, layer.uid, field.id);
  const pinned = layer.pinned.includes(field.id);
  const isComputed = field.computed !== undefined;
  const editable = (!isComputed || pinned) && !readOnly;
  const hasOverride = field.id in layer.overrides;
  const enumTable = field.enumRef ? registry.getEnum(field.enumRef) : undefined;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 transition-colors ${
        active ? 'bg-zinc-800/70' : ''
      }`}
      onMouseEnter={() => setHovered({ layerUid: layer.uid, fieldId: field.id })}
      onMouseLeave={() => setHovered(null)}
    >
      <button
        className="w-32 shrink-0 cursor-pointer truncate text-left text-[12px] text-zinc-400 hover:text-zinc-200"
        title={field.description}
        aria-label={`Highlight ${field.name} in the packet views`}
        aria-pressed={isActive(locked, layer.uid, field.id)}
        onClick={() => toggleLocked({ layerUid: layer.uid, fieldId: field.id })}
      >
        {field.name}
      </button>

      <div className="min-w-0 flex-1">
        {editable ? (
          layer.protocolId === 'ipv4' && field.id === 'options' && value instanceof Uint8Array ? (
            <Ipv4OptionsInput
              value={value}
              onCommit={(v) => setOverride(layer.uid, field.id, v)}
              rawFallback={
                <FieldInput
                  field={field}
                  value={value}
                  enumTable={enumTable}
                  onCommit={(v) => setOverride(layer.uid, field.id, v)}
                />
              }
            />
          ) : layer.protocolId === 'tcp' && field.id === 'options' && value instanceof Uint8Array ? (
            <TcpOptionsInput
              value={value}
              onCommit={(v) => setOverride(layer.uid, field.id, v)}
              rawFallback={
                <FieldInput
                  field={field}
                  value={value}
                  enumTable={enumTable}
                  onCommit={(v) => setOverride(layer.uid, field.id, v)}
                />
              }
            />
          ) : (
            <FieldInput
              field={field}
              value={value}
              enumTable={enumTable}
              onCommit={(v) =>
                pinned ? pinField(layer.uid, field.id, v) : setOverride(layer.uid, field.id, v)
              }
            />
          )
        ) : (
          <span
            className="block truncate font-mono text-[12px] text-zinc-300"
            title={value !== undefined ? formatFieldValue(field, value, enumTable) : ''}
          >
            {value !== undefined ? formatFieldValue(field, value, enumTable) : '—'}
          </span>
        )}
      </div>

      {isComputed && !readOnly && (
        <button
          className="shrink-0 cursor-pointer p-1.5 text-zinc-500 hover:text-zinc-200"
          aria-label={`${field.name}: ${pinned ? 'restore automatic value' : 'pin a manual value'}`}
          aria-pressed={pinned}
          title={
            pinned
              ? 'Pinned: manual value overrides the computed one. Click to restore auto.'
              : 'Computed automatically. Click to pin a manual value.'
          }
          onClick={() => {
            if (pinned) unpinField(layer.uid, field.id);
            else if (value !== undefined) pinField(layer.uid, field.id, value);
          }}
        >
          {pinned ? (
            <LockOpen className="size-3.5 text-amber-400" />
          ) : (
            <Lock className="size-3.5" />
          )}
        </button>
      )}
      {!isComputed && hasOverride && !readOnly && (
        <button
          className="shrink-0 cursor-pointer p-1.5 text-zinc-500 hover:text-zinc-200"
          aria-label={`Reset ${field.name} to default`}
          title="Reset to default"
          onClick={() => clearOverride(layer.uid, field.id)}
        >
          <RotateCcw className="size-3.5" />
        </button>
      )}
    </div>
  );
}
