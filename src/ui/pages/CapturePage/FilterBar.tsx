import { useState } from 'react';
import { FilterX } from 'lucide-react';
import type { CapturePacket, DecodeStatus } from '../../../core/capture';
import {
  EMPTY_FILTER,
  isEmptyFilter,
  protocolOptions,
  type CaptureFilter,
} from '../../../core/captureFilter';
import { getFilterAutocompletions, parseDisplayFilter } from '../../../core/displayFilter';

const STATUS_LABELS: { value: DecodeStatus; label: string }[] = [
  { value: 'exact', label: 'Decoded exactly' },
  { value: 'partial', label: 'Decoded partially' },
  { value: 'failed', label: 'Not decoded' },
];

const FIELD_CLASS =
  'rounded border border-zinc-700 bg-zinc-950/60 px-2 py-1 text-[12px] text-zinc-200 outline-none focus:border-cyan-600';

/** Parse a numeric control, treating a blank or unparseable entry as unset. */
const numberOrNull = (raw: string): number | null => {
  const value = Number(raw);
  return raw.trim() === '' || !Number.isFinite(value) ? null : value;
};

/** The structured filter controls above the packet list. */
export default function FilterBar({
  packets,
  filter,
  onChange,
  matched,
}: {
  packets: CapturePacket[];
  filter: CaptureFilter;
  onChange: (filter: CaptureFilter) => void;
  matched: number;
}) {
  const [showCompletions, setShowCompletions] = useState(false);
  const protocols = protocolOptions(packets);
  const set = <K extends keyof CaptureFilter>(key: K, value: CaptureFilter[K]) =>
    onChange({ ...filter, [key]: value });

  const filterResult = parseDisplayFilter(filter.text);
  const completions = getFilterAutocompletions(filter.text, packets);

  const applyCompletion = (completionItem: string) => {
    const match = filter.text.match(/([a-zA-Z0-9._-]+)$/);
    if (match) {
      const idx = filter.text.lastIndexOf(match[1]!);
      const nextText = filter.text.slice(0, idx) + completionItem + ' ';
      set('text', nextText);
    } else {
      set('text', filter.text + completionItem + ' ');
    }
    setShowCompletions(false);
  };

  return (
    <section
      aria-label="Capture filters"
      className="flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-900/30 px-6 py-2"
    >
      <div className="relative flex items-center gap-1.5">
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Search packets or Wireshark filter</span>
          <input
            type="search"
            className={`${FIELD_CLASS} w-64 font-mono text-[12px] ${
              filterResult.error ? 'border-amber-600/80 focus:border-amber-500' : ''
            }`}
            placeholder="Search or filter: ip.src == 192.168.1.1..."
            value={filter.text}
            onFocus={() => setShowCompletions(true)}
            onBlur={() => setTimeout(() => setShowCompletions(false), 200)}
            onChange={(e) => {
              set('text', e.target.value);
              setShowCompletions(true);
            }}
          />
        </label>
        {filterResult.error && filter.text.trim().length > 0 && (
          <span
            className="truncate text-[11px] font-mono text-amber-400"
            title={filterResult.error}
          >
            ⚠️ {filterResult.error}
          </span>
        )}
        {showCompletions && completions.length > 0 && (
          <div className="absolute top-full left-0 z-30 mt-1 max-h-48 w-64 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 shadow-xl font-mono text-[11px]">
            <div className="bg-zinc-950 px-2 py-1 text-[10px] tracking-wider text-zinc-500 uppercase">
              Wireshark Filter Suggestions
            </div>
            {completions.map((item) => (
              <button
                key={item.completion}
                type="button"
                className="flex w-full cursor-pointer items-center justify-between px-2.5 py-1.5 text-left text-zinc-200 hover:bg-cyan-950/60 hover:text-cyan-300"
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyCompletion(item.completion);
                }}
              >
                <span className="font-medium text-cyan-400">{item.label}</span>
                <span className="text-[10px] text-zinc-500">{item.detail}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <label className="flex items-center gap-1.5 text-[12px] text-zinc-500">
        Protocol
        <select
          className={`${FIELD_CLASS} cursor-pointer`}
          aria-label="Protocol"
          value={filter.protocolId ?? ''}
          onChange={(e) => set('protocolId', e.target.value === '' ? null : e.target.value)}
        >
          <option value="">Any</option>
          {protocols.map((protocol) => (
            <option key={protocol.id} value={protocol.id}>
              {protocol.name} ({protocol.count})
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-[12px] text-zinc-500">
        Address
        <input
          className={`${FIELD_CLASS} w-32 font-mono`}
          aria-label="Address"
          placeholder="any"
          value={filter.address}
          onChange={(e) => set('address', e.target.value)}
        />
      </label>

      <label className="flex items-center gap-1.5 text-[12px] text-zinc-500">
        Port
        <input
          type="number"
          min={0}
          max={65535}
          className={`${FIELD_CLASS} w-20 font-mono`}
          aria-label="Port"
          placeholder="any"
          value={filter.port ?? ''}
          onChange={(e) => set('port', numberOrNull(e.target.value))}
        />
      </label>

      <span className="flex items-center gap-1.5 text-[12px] text-zinc-500">
        Length
        <input
          type="number"
          min={0}
          className={`${FIELD_CLASS} w-20 font-mono`}
          aria-label="Minimum length"
          placeholder="min"
          value={filter.minLength ?? ''}
          onChange={(e) => set('minLength', numberOrNull(e.target.value))}
        />
        <input
          type="number"
          min={0}
          className={`${FIELD_CLASS} w-20 font-mono`}
          aria-label="Maximum length"
          placeholder="max"
          value={filter.maxLength ?? ''}
          onChange={(e) => set('maxLength', numberOrNull(e.target.value))}
        />
      </span>

      <label className="flex items-center gap-1.5 text-[12px] text-zinc-500">
        Decode
        <select
          className={`${FIELD_CLASS} cursor-pointer`}
          aria-label="Decode status"
          value={filter.status ?? ''}
          onChange={(e) =>
            set('status', e.target.value === '' ? null : (e.target.value as DecodeStatus))
          }
        >
          <option value="">Any</option>
          {STATUS_LABELS.map((status) => (
            <option key={status.value} value={status.value}>
              {status.label}
            </option>
          ))}
        </select>
      </label>

      <button
        className="flex cursor-pointer items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[12px] text-zinc-300 hover:border-cyan-600 hover:text-cyan-300 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600"
        disabled={isEmptyFilter(filter)}
        onClick={() => onChange(EMPTY_FILTER)}
      >
        <FilterX className="size-3.5" aria-hidden />
        Clear filters
      </button>

      <span className="ml-auto font-mono text-[12px] text-zinc-500" role="status" aria-live="polite">
        {matched} of {packets.length} packets
      </span>
    </section>
  );
}
