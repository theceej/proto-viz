import { useMemo, useState } from 'react';
import type { Registry } from '../../core/registry';
import type { FieldValue } from '../../core/model';
import type { SerializedPacket } from '../../core/serialize';
import {
  comparePackets,
  type ByteRange,
  type DifferenceStatus,
} from '../../core/comparePackets';

const STATUS: Record<DifferenceStatus, { symbol: string; label: string; className: string }> = {
  unchanged: { symbol: '=', label: 'Unchanged', className: 'border-zinc-600 text-zinc-300' },
  changed: { symbol: '≠', label: 'Changed', className: 'border-amber-700 text-amber-300' },
  added: { symbol: '+', label: 'Added', className: 'border-emerald-700 text-emerald-300' },
  removed: { symbol: '−', label: 'Removed', className: 'border-rose-700 text-rose-300' },
};

function valueText(value: FieldValue | undefined): string {
  if (value === undefined) return '—';
  if (value instanceof Uint8Array) {
    return [...value].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
  }
  return String(value);
}

function StatusBadge({ status }: { status: DifferenceStatus }) {
  const meta = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${meta.className}`}>
      <span aria-hidden>{meta.symbol}</span>
      {meta.label}
    </span>
  );
}

function inRange(index: number, range: ByteRange | null): boolean {
  return Boolean(range && index >= range.start && index <= range.end);
}

export default function PacketComparisonView({
  leftLabel,
  rightLabel,
  leftPacket,
  rightPacket,
  registry,
}: {
  leftLabel: string;
  rightLabel: string;
  leftPacket: SerializedPacket;
  rightPacket: SerializedPacket;
  registry: Registry;
}) {
  const comparison = useMemo(
    () => comparePackets(leftPacket, rightPacket),
    [leftPacket, rightPacket],
  );
  const changed = comparison.layers.flatMap((layer) => layer.fields).filter((field) => field.status !== 'unchanged');
  const [selectedKey, setSelectedKey] = useState<string | null>(changed[0]?.key ?? null);
  const selected = comparison.layers
    .flatMap((layer) => layer.fields)
    .find((field) => field.key === selectedKey) ?? null;

  return (
    <section aria-label="Packet comparison" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 bg-zinc-900/30 px-5 py-2">
        <strong className="text-[12px] text-zinc-200">Semantic differences</strong>
        <span className="rounded bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-300">
          {comparison.editableChanges} editable
        </span>
        <span className="rounded bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-300">
          {comparison.computedChanges} computed
        </span>
        <span className="text-[11px] text-zinc-400">
          Select a field or differing byte to synchronize the views.
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(32rem,1.15fr)_minmax(30rem,1fr)]">
        <div className="overflow-auto border-r border-zinc-800 p-4">
          <h2 className="mb-3 text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
            Aligned fields
          </h2>
          {comparison.layers.map((layer) => {
            const def = registry.get(layer.protocolId);
            return (
              <section key={layer.key} className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/30">
                <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
                  <h3 className="text-[12px] font-semibold text-zinc-200">{def?.name ?? layer.protocolId}</h3>
                  <span className="font-mono text-[10px] text-zinc-400">{layer.key.split(':').at(-1)! === '0' ? '' : `instance ${Number(layer.key.split(':').at(-1)) + 1}`}</span>
                  <span className="ml-auto"><StatusBadge status={layer.status} /></span>
                </div>
                <div className="grid grid-cols-[minmax(9rem,1fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_auto] text-[11px]">
                  <div className="border-b border-zinc-800/70 px-3 py-1 font-semibold text-zinc-400">Field</div>
                  <div className="border-b border-zinc-800/70 px-3 py-1 font-semibold text-zinc-400">{leftLabel}</div>
                  <div className="border-b border-zinc-800/70 px-3 py-1 font-semibold text-zinc-400">{rightLabel}</div>
                  <div className="border-b border-zinc-800/70 px-3 py-1 font-semibold text-zinc-400">Result</div>
                  {layer.fields.map((field) => {
                    const fieldDef = def?.fields.find((candidate) => candidate.id === field.fieldId);
                    const active = selectedKey === field.key;
                    return (
                      <button
                        key={field.key}
                        className={`col-span-4 grid cursor-pointer grid-cols-subgrid text-left focus-visible:outline-2 focus-visible:outline-cyan-400 ${active ? 'bg-cyan-500/10' : 'hover:bg-zinc-800/40'}`}
                        aria-pressed={active}
                        aria-label={`${fieldDef?.name ?? field.fieldId}: ${STATUS[field.status].label}${field.computed ? ', computed' : ''}`}
                        onClick={() => setSelectedKey(field.key)}
                      >
                        <span className="border-b border-zinc-800/50 px-3 py-1.5 text-zinc-300">{fieldDef?.name ?? field.fieldId}</span>
                        <span className="truncate border-b border-zinc-800/50 px-3 py-1.5 font-mono text-zinc-300">{valueText(field.left?.value)}</span>
                        <span className="truncate border-b border-zinc-800/50 px-3 py-1.5 font-mono text-zinc-300">{valueText(field.right?.value)}</span>
                        <span className="flex items-center gap-1 border-b border-zinc-800/50 px-3 py-1.5">
                          <StatusBadge status={field.status} />
                          {field.computed && <span className="rounded bg-violet-500/15 px-1 text-[9px] text-violet-300">computed</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
        <div className="min-h-0 overflow-auto p-4">
          <h2 className="mb-3 text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
            Aligned bytes
          </h2>
          <div className="grid grid-cols-[4rem_1fr_1fr_7rem] overflow-hidden rounded-lg border border-zinc-800 font-mono text-[11px]">
            <div className="bg-zinc-900 px-3 py-2 text-zinc-400">Offset</div>
            <div className="bg-zinc-900 px-3 py-2 text-zinc-400">{leftLabel}</div>
            <div className="bg-zinc-900 px-3 py-2 text-zinc-400">{rightLabel}</div>
            <div className="bg-zinc-900 px-3 py-2 text-zinc-400">Result</div>
            {comparison.bytes.map((byte) => {
              const active =
                inRange(byte.index, selected?.leftBytes ?? null) ||
                inRange(byte.index, selected?.rightBytes ?? null);
              return (
                <button
                  key={byte.index}
                  className={`col-span-4 grid grid-cols-subgrid cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-cyan-400 ${active ? 'bg-cyan-500/15' : byte.status === 'unchanged' ? 'hover:bg-zinc-800/40' : 'hover:bg-zinc-800/60'}`}
                  aria-pressed={active}
                  aria-label={`Byte ${byte.index}: ${STATUS[byte.status].label}${byte.fieldKey ? ', select related field' : ''}`}
                  onClick={() => byte.fieldKey && setSelectedKey(byte.fieldKey)}
                >
                  <span className="border-t border-zinc-800/60 px-3 py-1.5 text-zinc-400">{byte.index.toString(16).padStart(4, '0')}</span>
                  <span className="border-t border-zinc-800/60 px-3 py-1.5 text-zinc-300">{byte.left?.toString(16).padStart(2, '0') ?? '—'}</span>
                  <span className="border-t border-zinc-800/60 px-3 py-1.5 text-zinc-300">{byte.right?.toString(16).padStart(2, '0') ?? '—'}</span>
                  <span className="border-t border-zinc-800/60 px-3 py-1.5 font-sans"><StatusBadge status={byte.status} /></span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
