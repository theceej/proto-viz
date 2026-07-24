import { useMemo, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, ChevronRight, GripVertical, OctagonX, Plus, X } from 'lucide-react';
import type { LayerInstance } from '../../core/model';
import type { Registry } from '../../core/registry';
import type { SerializedPacket } from '../../core/serialize';
import { resolveBinding } from '../../core/bindings';
import {
  getValidNextProtocols,
  type NextProtocolOption,
  type ValidationIssue,
} from '../../core/validate';
import { useStackStore } from '../../store/stackStore';
import { useEscape } from '../a11y';
import { layerColor } from '../colors';

/** Horizontal stack of layer chips, outermost on the left, with add/reorder. */
export default function StackStrip({
  layers,
  registry,
  validation,
  packet,
}: {
  layers: LayerInstance[];
  registry: Registry;
  validation: ValidationIssue[];
  packet?: SerializedPacket | null;
}) {
  const { moveLayer, removeLayer } = useStackStore();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = layers.findIndex((l) => l.uid === active.id);
    const to = layers.findIndex((l) => l.uid === over.id);
    if (from >= 0 && to >= 0) moveLayer(from, to);
  };

  const worstByLayer = useMemo(() => {
    const map = new Map<number, 'error' | 'warning'>();
    for (const issue of validation) {
      if (issue.layerIndex < 0 || issue.severity === 'info' || issue.severity === 'advisory') continue;
      const cur = map.get(issue.layerIndex);
      if (issue.severity === 'error' || cur === undefined) map.set(issue.layerIndex, issue.severity);
    }
    return map;
  }, [validation]);

  return (
    <div className="flex flex-wrap items-center gap-1 px-6 py-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={layers.map((l) => l.uid)} strategy={horizontalListSortingStrategy}>
          {layers.map((layer, i) => {
            const def = registry.get(layer.protocolId);
            const next = layers[i + 1] ? registry.get(layers[i + 1]!.protocolId) : undefined;
            const binding = def && next ? resolveBinding(def, next) : null;
            const via =
              binding && binding.claim.value !== undefined && binding.namespace.selectorFieldId
                ? `${binding.namespace.displayName} ${
                    binding.claim.value > 255
                      ? '0x' + binding.claim.value.toString(16).toUpperCase()
                      : binding.claim.value
                  }`
                : null;
            return (
              <div key={layer.uid} className="flex items-center gap-1">
                <LayerChip
                  uid={layer.uid}
                  name={def?.name ?? layer.protocolId}
                  colorIndex={i}
                  severity={worstByLayer.get(i)}
                  onRemove={() => removeLayer(layer.uid)}
                />
                {i < layers.length - 1 && (
                  <span className="flex flex-col items-center px-0.5" title={via ?? undefined}>
                    <ChevronRight className="size-4 text-zinc-600" />
                    {via && (
                      <span className="-mt-0.5 max-w-24 truncate font-mono text-[9px] text-zinc-500">
                        {via}
                      </span>
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </SortableContext>
      </DndContext>
      <AddLayerButton layers={layers} registry={registry} />
      {packet && (
        <span className="ml-auto self-center rounded-md border border-zinc-800 bg-zinc-900/50 px-2 py-0.5 font-mono text-[11px] whitespace-nowrap text-zinc-400">
          {packet.bytes.length} B
          <span className="text-zinc-600"> · {packet.payloadOffset} B header</span>
        </span>
      )}
    </div>
  );
}

function LayerChip({
  uid,
  name,
  colorIndex,
  severity,
  onRemove,
}: {
  uid: string;
  name: string;
  colorIndex: number;
  severity?: 'error' | 'warning';
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: uid });
  const color = layerColor(colorIndex);
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        borderColor: color.border,
        background: color.fill,
        opacity: isDragging ? 0.6 : 1,
      }}
      className="group flex items-center gap-1 rounded-md border py-1 pr-1 pl-1.5"
    >
      {/* Dedicated drag handle so interactive controls aren't nested inside
          the sortable widget; keyboard: focus, Space to lift, arrows to move. */}
      <button
        className="cursor-grab rounded p-1 text-zinc-500 hover:text-zinc-200 active:cursor-grabbing"
        aria-label={`Reorder ${name} layer`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" />
      </button>
      <span className="size-2 rounded-full" style={{ background: color.accent }} aria-hidden />
      <span className="text-[13px] font-medium text-zinc-100">{name}</span>
      {severity === 'error' && (
        <OctagonX className="size-3.5 text-rose-400" role="img" aria-label="has errors" />
      )}
      {severity === 'warning' && (
        <AlertTriangle className="size-3.5 text-amber-400" role="img" aria-label="has warnings" />
      )}
      <button
        className="cursor-pointer rounded p-1 text-zinc-500 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-zinc-700/60 hover:text-zinc-200"
        onClick={onRemove}
        aria-label={`Remove ${name} layer`}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function AddLayerButton({
  layers,
  registry,
}: {
  layers: LayerInstance[];
  registry: Registry;
}) {
  const [open, setOpen] = useState(false);
  const addLayer = useStackStore((s) => s.addLayer);
  const ref = useRef<HTMLDivElement>(null);
  useEscape(open, () => setOpen(false));

  const options = useMemo(
    () => getValidNextProtocols({ layers }, registry),
    [layers, registry],
  );
  const sorted = useMemo(
    () => [...options].sort((a, b) => Number(b.allowed) - Number(a.allowed)),
    [options],
  );

  return (
    <div className="relative" ref={ref}>
      <button
        className="ml-1 flex cursor-pointer items-center gap-1 rounded-md border border-dashed border-zinc-700 px-2.5 py-1.5 text-[13px] text-zinc-400 transition-colors hover:border-cyan-600 hover:text-cyan-300"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
      >
        <Plus className="size-3.5" />
        Add layer
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 z-20 mt-1 max-h-96 w-80 overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl shadow-black/50">
            {sorted.map((opt) => (
              <PaletteRow
                key={opt.protocolId}
                option={opt}
                registry={registry}
                onPick={() => {
                  addLayer(opt.protocolId);
                  setOpen(false);
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PaletteRow({
  option,
  registry,
  onPick,
}: {
  option: NextProtocolOption;
  registry: Registry;
  onPick: () => void;
}) {
  const def = registry.get(option.protocolId);
  if (!def) return null;
  return (
    <button
      className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left ${
        option.allowed
          ? 'cursor-pointer hover:bg-zinc-800'
          : 'cursor-not-allowed opacity-40'
      }`}
      disabled={!option.allowed}
      title={option.reason ?? option.note}
      onClick={onPick}
    >
      <span className="text-[13px] font-medium text-zinc-100">{def.name}</span>
      <span className="truncate font-mono text-[10px] text-zinc-500">
        {option.via ?? (option.allowed ? def.layerHint : option.reason)}
      </span>
    </button>
  );
}
