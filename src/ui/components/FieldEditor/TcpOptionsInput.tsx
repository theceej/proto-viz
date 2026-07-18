import type { ReactNode } from 'react';
import { decodeTcpOptions, encodeTcpOptions, type TcpOptions } from '../../../core/tcpOptions';

/**
 * Structured editor for the TCP `options` field. Falls back to the raw
 * hex/bytes editor when the on-wire bytes can't be decoded into the modeled
 * option set.
 */
export default function TcpOptionsInput({
  value,
  onCommit,
  rawFallback,
}: {
  value: Uint8Array;
  onCommit: (value: Uint8Array) => void;
  rawFallback: ReactNode;
}) {
  const options = decodeTcpOptions(value);
  if (options === null) return <>{rawFallback}</>;
  const update = (next: TcpOptions) => onCommit(encodeTcpOptions(next));
  const number = (
    label: string,
    current: number | undefined,
    max: number,
    change: (value: number | undefined) => TcpOptions,
  ) => (
    <label className="flex items-center gap-1 text-[11px] text-zinc-400">
      <input
        type="checkbox"
        className="size-4 accent-cyan-500"
        checked={current !== undefined}
        onChange={(event) => update(change(event.target.checked ? 0 : undefined))}
      />
      {label}
      {current !== undefined && (
        <input
          aria-label={`${label} value`}
          type="number"
          min={0}
          max={max}
          className="w-20 rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 font-mono text-zinc-200"
          value={current}
          onChange={(event) => update(change(Math.min(max, Math.max(0, Number(event.target.value)))))}
        />
      )}
    </label>
  );
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1" role="group" aria-label="TCP options">
      {number('MSS', options.mss, 65535, (mss) => ({ ...options, mss }))}
      <label className="flex items-center gap-1 text-[11px] text-zinc-400">
        <input
          type="checkbox"
          className="size-4 accent-cyan-500"
          checked={options.sackPermitted === true}
          onChange={(event) => update({ ...options, sackPermitted: event.target.checked || undefined })}
        />
        SACK permitted
      </label>
      {number('Window scale', options.windowScale, 14, (windowScale) => ({ ...options, windowScale }))}
      <label className="flex items-center gap-1 text-[11px] text-zinc-400">
        <input
          type="checkbox"
          className="size-4 accent-cyan-500"
          checked={options.timestamp !== undefined}
          onChange={(event) =>
            update({ ...options, timestamp: event.target.checked ? { value: 0, echoReply: 0 } : undefined })
          }
        />
        Timestamps
      </label>
      {options.timestamp && (
        <>
          <input
            aria-label="Timestamp value"
            type="number"
            min={0}
            max={0xffffffff}
            className="w-28 rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 font-mono text-[11px] text-zinc-200"
            value={options.timestamp.value}
            onChange={(event) =>
              update({ ...options, timestamp: { ...options.timestamp!, value: Number(event.target.value) >>> 0 } })
            }
          />
          <input
            aria-label="Timestamp echo reply"
            type="number"
            min={0}
            max={0xffffffff}
            className="w-28 rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 font-mono text-[11px] text-zinc-200"
            value={options.timestamp.echoReply}
            onChange={(event) =>
              update({ ...options, timestamp: { ...options.timestamp!, echoReply: Number(event.target.value) >>> 0 } })
            }
          />
        </>
      )}
    </div>
  );
}
