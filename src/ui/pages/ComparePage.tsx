import { Trash2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLibraryStore } from '../../store/libraryStore';
import { useComparisonStore } from '../../store/comparisonStore';
import PacketComparisonView from '../components/PacketComparisonView';

export default function ComparePage() {
  const registry = useLibraryStore((state) => state.registry);
  const packets = useComparisonStore((state) => state.packets);
  const removePacket = useComparisonStore((state) => state.removePacket);
  const clear = useComparisonStore((state) => state.clear);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-6 py-3">
        <h1 className="text-[15px] font-semibold tracking-tight text-zinc-100">Packet Comparison</h1>
        <span className="text-[12px] text-zinc-500">Compare packet fields and their encoded bytes.</span>
        {packets.length > 0 && (
          <button
            className="ml-auto flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-700 px-2 py-1 text-[12px] text-zinc-400 hover:border-rose-700 hover:bg-rose-500/5 hover:text-rose-300"
            aria-label="Clear comparison"
            title="Remove both packets from the comparison"
            onClick={clear}
          >
            <Trash2 className="size-3.5 shrink-0" aria-hidden />
            <span className="hidden sm:inline">Clear</span>
          </button>
        )}
      </header>

      <section className="flex flex-wrap gap-3 border-b border-zinc-800 bg-zinc-900/30 px-6 py-3" aria-label="Packets selected for comparison">
        {[0, 1].map((index) => {
          const item = packets[index];
          return (
            <div key={item?.id ?? `empty-${index}`} className="flex min-w-60 flex-1 items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded bg-cyan-500/10 text-[11px] font-semibold text-cyan-300">
                {index === 0 ? 'A' : 'B'}
              </span>
              {item ? (
                <>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-200">{item.label}</span>
                  <span className="font-mono text-[10px] text-zinc-500">{item.packet.bytes.length} bytes</span>
                  <button className="cursor-pointer rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label={`Remove packet ${index === 0 ? 'A' : 'B'}: ${item.label}`} onClick={() => removePacket(item.id)}>
                    <X className="size-3.5" />
                  </button>
                </>
              ) : (
                <span className="text-[12px] text-zinc-500">No packet selected</span>
              )}
            </div>
          );
        })}
      </section>

      {packets.length === 2 ? (
        <PacketComparisonView
          key={`${packets[0]!.id}:${packets[1]!.id}`}
          leftLabel={packets[0]!.label}
          rightLabel={packets[1]!.label}
          leftPacket={packets[0]!.packet}
          rightPacket={packets[1]!.packet}
          registry={registry}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-zinc-300">Add {packets.length === 0 ? 'two packets' : 'one more packet'} to start comparing.</p>
          <p className="max-w-lg text-[13px] leading-relaxed text-zinc-500">
            Use <strong className="font-medium text-zinc-400">Add to compare</strong> in the{' '}
            <Link className="text-cyan-300 underline underline-offset-2" to="/builder">Stack Builder</Link> or on any step in the{' '}
            <Link className="text-cyan-300 underline underline-offset-2" to="/scenario">Scenario Timeline</Link>.
            Adding a third packet replaces the oldest selection.
          </p>
        </div>
      )}
    </div>
  );
}
