import { Plus } from 'lucide-react';
import type { SerializedPacket } from '../../core/serialize';
import { useComparisonStore } from '../../store/comparisonStore';

export default function AddToCompareButton({
  packet,
  label,
  labelClass = '',
}: {
  packet: SerializedPacket | null;
  label: string;
  /** Extra classes controlling when the text label shows (container queries). */
  labelClass?: string;
}) {
  const addPacket = useComparisonStore((state) => state.addPacket);
  const count = useComparisonStore((state) => state.packets.length);

  return (
    <button
      className="flex cursor-pointer items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[12px] text-zinc-300 hover:border-cyan-600 hover:text-cyan-300 disabled:cursor-not-allowed disabled:text-zinc-600"
      disabled={!packet}
      aria-label="Add to compare"
      title={count === 2 ? 'Add packet and replace the oldest comparison selection' : 'Add packet to comparison'}
      onClick={() => packet && addPacket(packet, label)}
    >
      <Plus className="size-3.5 shrink-0" aria-hidden />
      <span className={labelClass}>Add to compare</span>
      {count > 0 && (
        <span className="text-[10px] text-zinc-500" aria-label={`${count} of 2 comparison slots filled`}>
          ({count}/2)
        </span>
      )}
    </button>
  );
}
