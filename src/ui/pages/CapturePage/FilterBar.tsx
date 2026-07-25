import { FilterX } from 'lucide-react';
import type { CapturePacket, DecodeStatus } from '../../../core/capture';
import {
  EMPTY_FILTER,
  isEmptyFilter,
  protocolOptions,
  type CaptureFilter,
} from '../../../core/captureFilter';

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
  const protocols = protocolOptions(packets);
  const set = <K extends keyof CaptureFilter>(key: K, value: CaptureFilter[K]) =>
    onChange({ ...filter, [key]: value });

  return (
    <section
      aria-label="Capture filters"
      className="flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-900/30 px-6 py-2"
    >
      <label className="flex items-center gap-1.5">
        <span className="sr-only">Search packets</span>
        <input
          type="search"
          className={`${FIELD_CLASS} w-52`}
          placeholder="Search summaries and fields"
          value={filter.text}
          onChange={(e) => set('text', e.target.value)}
        />
      </label>

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
