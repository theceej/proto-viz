import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CircleAlert,
  MessageSquareText,
  Scissors,
} from 'lucide-react';
import type { CapturePacket } from '../../../core/capture';
import { formatRelativeTime } from './format';

export type SortKey = 'number' | 'time' | 'source' | 'destination' | 'protocol' | 'length';
export interface Sort {
  key: SortKey;
  ascending: boolean;
}

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: 'number', label: '#', className: 'w-16 text-right' },
  { key: 'time', label: 'Time', className: 'w-28 text-right' },
  { key: 'source', label: 'Source', className: 'w-44' },
  { key: 'destination', label: 'Destination', className: 'w-44' },
  { key: 'protocol', label: 'Protocol', className: 'w-28' },
  { key: 'length', label: 'Length', className: 'w-20 text-right' },
];

/**
 * Rows are rendered in pages rather than all at once: the importer's cap
 * allows a couple of thousand packets, and re-rendering every one of them on
 * each filter keystroke is what would make filtering feel slow.
 */
const PAGE_SIZE = 300;

/** Compare two packets on the active sort key, falling back to file order. */
export function comparePackets(a: CapturePacket, b: CapturePacket, sort: Sort): number {
  const direction = sort.ascending ? 1 : -1;
  const byKey = (): number => {
    switch (sort.key) {
      case 'number':
      case 'time':
        return a.number - b.number;
      case 'source':
        return (a.source ?? '').localeCompare(b.source ?? '');
      case 'destination':
        return (a.destination ?? '').localeCompare(b.destination ?? '');
      case 'protocol':
        return a.topProtocol.localeCompare(b.topProtocol);
      case 'length':
        return a.capturedLength - b.capturedLength;
    }
  };
  return byKey() * direction || a.number - b.number;
}

/** The capture's packets as a sortable, selectable table. */
export default function PacketList({
  packets,
  selected,
  onSelect,
  sort,
  onSortChange,
}: {
  packets: CapturePacket[];
  selected: number | null;
  onSelect: (packetNumber: number) => void;
  sort: Sort;
  onSortChange: (sort: Sort) => void;
}) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>());
  // Focus follows arrow-key movement only; clicking a row or a flow must not
  // yank focus out of whatever the user was using.
  const focusNext = useRef(false);

  // A new filter or sort makes the current window meaningless, so it resets
  // during render (rather than in an effect, which would render twice).
  const [windowFor, setWindowFor] = useState({ packets, sort });
  if (windowFor.packets !== packets || windowFor.sort !== sort) {
    setWindowFor({ packets, sort });
    setVisible(PAGE_SIZE);
  }

  useEffect(() => {
    if (!focusNext.current || selected === null) return;
    focusNext.current = false;
    rowRefs.current.get(selected)?.focus();
  }, [selected]);

  const shown = packets.slice(0, visible);

  const move = (delta: number) => {
    if (packets.length === 0) return;
    const current = packets.findIndex((packet) => packet.number === selected);
    const next = Math.min(packets.length - 1, Math.max(0, (current < 0 ? 0 : current) + delta));
    const target = packets[next];
    if (!target) return;
    // Keep the target rendered before asking the browser to focus it.
    if (next >= visible) setVisible(Math.ceil((next + 1) / PAGE_SIZE) * PAGE_SIZE);
    focusNext.current = true;
    onSelect(target.number);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const steps: Record<string, number> = {
      ArrowDown: 1,
      ArrowUp: -1,
      PageDown: 10,
      PageUp: -10,
    };
    const delta = steps[e.key];
    if (delta !== undefined) {
      e.preventDefault();
      move(delta);
    } else if (e.key === 'Home') {
      e.preventDefault();
      move(-packets.length);
    } else if (e.key === 'End') {
      e.preventDefault();
      move(packets.length);
    }
  };

  if (packets.length === 0) {
    return (
      <p className="px-6 py-8 text-center text-[13px] text-zinc-500">
        No packets match the current filters.
      </p>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table role="grid" className="w-full border-collapse text-[12px]">
        <caption className="sr-only">
          Captured packets. Use the arrow keys to move between packets.
        </caption>
        <thead className="sticky top-0 z-10 bg-zinc-900">
          <tr>
            {COLUMNS.map((column) => {
              const active = sort.key === column.key;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={active ? (sort.ascending ? 'ascending' : 'descending') : 'none'}
                  className={`border-b border-zinc-800 px-2 py-1.5 font-medium text-zinc-400 ${column.className}`}
                >
                  <button
                    className="inline-flex cursor-pointer items-center gap-1 hover:text-cyan-300"
                    onClick={() =>
                      onSortChange({
                        key: column.key,
                        ascending: active ? !sort.ascending : true,
                      })
                    }
                  >
                    {column.label}
                    {active &&
                      (sort.ascending ? (
                        <ArrowUp className="size-3" aria-hidden />
                      ) : (
                        <ArrowDown className="size-3" aria-hidden />
                      ))}
                  </button>
                </th>
              );
            })}
            <th
              scope="col"
              className="border-b border-zinc-800 px-2 py-1.5 text-left font-medium text-zinc-400"
            >
              Info
            </th>
          </tr>
        </thead>
        <tbody onKeyDown={onKeyDown}>
          {shown.map((packet) => {
            const isSelected = packet.number === selected;
            return (
              <tr
                key={packet.number}
                ref={(el) => {
                  if (el) rowRefs.current.set(packet.number, el);
                  else rowRefs.current.delete(packet.number);
                }}
                aria-selected={isSelected}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => onSelect(packet.number)}
                className={`cursor-pointer border-b border-zinc-900 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cyan-400 ${
                  isSelected ? 'bg-cyan-500/15 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-800/50'
                }`}
              >
                <td className="px-2 py-1 text-right font-mono text-zinc-500">{packet.number}</td>
                <td className="px-2 py-1 text-right font-mono">
                  {formatRelativeTime(packet.relativeUsec)}
                </td>
                <td className="truncate px-2 py-1 font-mono" title={packet.source ?? ''}>
                  {packet.source ?? '—'}
                  {packet.srcPort !== null && (
                    <span className="text-zinc-500">:{packet.srcPort}</span>
                  )}
                </td>
                <td className="truncate px-2 py-1 font-mono" title={packet.destination ?? ''}>
                  {packet.destination ?? '—'}
                  {packet.dstPort !== null && (
                    <span className="text-zinc-500">:{packet.dstPort}</span>
                  )}
                </td>
                <td className="truncate px-2 py-1" title={packet.protocols.join(' › ')}>
                  {packet.topProtocol}
                </td>
                <td className="px-2 py-1 text-right font-mono">{packet.capturedLength}</td>
                <td className="px-2 py-1">
                  <span className="flex items-center gap-1.5">
                    <StatusIcon packet={packet} />
                    <span className="truncate text-zinc-400">{packet.summary}</span>
                    {packet.comment !== undefined && (
                      // A pcapng comment is the file's own label for this
                      // packet — a scenario step name, usually — so it earns
                      // more prominence than the derived summary.
                      <span className="truncate text-zinc-200" title={packet.comment}>
                        <MessageSquareText
                          className="mr-1 inline size-3 align-[-1px] text-zinc-500"
                          aria-hidden
                        />
                        {packet.comment}
                      </span>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {visible < packets.length && (
        <div className="flex justify-center py-3">
          <button
            className="cursor-pointer rounded-md border border-zinc-700 px-3 py-1.5 text-[12px] text-zinc-300 hover:border-cyan-600 hover:text-cyan-300"
            onClick={() => setVisible(visible + PAGE_SIZE)}
          >
            Show {Math.min(PAGE_SIZE, packets.length - visible)} more of {packets.length}
          </button>
        </div>
      )}
    </div>
  );
}

/** Marks the rows whose bytes the decoder could not fully account for. */
function StatusIcon({ packet }: { packet: CapturePacket }) {
  if (packet.status === 'failed') {
    return <CircleAlert className="size-3.5 shrink-0 text-rose-400" aria-label="Not decoded" />;
  }
  if (packet.snapped) {
    return (
      <Scissors className="size-3.5 shrink-0 text-amber-300" aria-label="Cut short by snap length" />
    );
  }
  if (packet.status === 'partial') {
    return (
      <AlertTriangle
        className="size-3.5 shrink-0 text-amber-300"
        aria-label="Decoded but not byte-exact"
      />
    );
  }
  return <span className="size-3.5 shrink-0" aria-hidden />;
}
