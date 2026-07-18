import type { ReactNode } from 'react';
import { decodeIpv4Options, encodeIpv4Options, type Ipv4Options } from '../../../core/ipv4Options';

/**
 * Structured editor for the IPv4 `options` field. Falls back to the raw
 * hex/bytes editor when the on-wire bytes can't be decoded into the modeled
 * option set.
 */
export default function Ipv4OptionsInput({
  value,
  onCommit,
  rawFallback,
}: {
  value: Uint8Array;
  onCommit: (value: Uint8Array) => void;
  rawFallback: ReactNode;
}) {
  const options = decodeIpv4Options(value);
  if (options === null) return <>{rawFallback}</>;
  const update = (next: Ipv4Options) => {
    try {
      onCommit(encodeIpv4Options(next));
    } catch {
      /* keep the last valid header */
    }
  };
  const routes = (
    label: string,
    current: string[] | undefined,
    change: (routes: string[] | undefined) => Ipv4Options,
  ) => (
    <label className="flex items-center gap-1 text-[11px] text-zinc-400">
      <input
        type="checkbox"
        className="size-4 accent-cyan-500"
        checked={current !== undefined}
        onChange={(event) => update(change(event.target.checked ? [] : undefined))}
      />
      {label}
      {current !== undefined && (
        <input
          aria-label={`${label} addresses`}
          className="w-48 rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 font-mono text-zinc-200"
          defaultValue={current.join(', ')}
          placeholder="192.0.2.1, 198.51.100.1"
          onBlur={(event) =>
            update(change(event.target.value.split(',').map((item) => item.trim()).filter(Boolean)))
          }
        />
      )}
    </label>
  );
  return (
    <div className="flex flex-col gap-1" role="group" aria-label="IPv4 options">
      <label className="flex items-center gap-1 text-[11px] text-zinc-400">
        <input
          type="checkbox"
          className="size-4 accent-cyan-500"
          checked={options.routerAlert !== undefined}
          onChange={(event) => update({ ...options, routerAlert: event.target.checked ? 0 : undefined })}
        />
        Router Alert
        {options.routerAlert !== undefined && (
          <input
            aria-label="Router Alert value"
            type="number"
            min={0}
            max={65535}
            className="w-20 rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 font-mono text-zinc-200"
            value={options.routerAlert}
            onChange={(event) => update({ ...options, routerAlert: Number(event.target.value) })}
          />
        )}
      </label>
      {routes('Record Route', options.recordRoute, (recordRoute) => ({ ...options, recordRoute }))}
      {routes('Loose Source Route', options.looseSourceRoute, (looseSourceRoute) => ({
        ...options,
        looseSourceRoute,
      }))}
      {routes('Strict Source Route', options.strictSourceRoute, (strictSourceRoute) => ({
        ...options,
        strictSourceRoute,
      }))}
      <label className="flex items-center gap-1 text-[11px] text-zinc-400">
        <input
          type="checkbox"
          className="size-4 accent-cyan-500"
          checked={options.timestamps !== undefined}
          onChange={(event) => update({ ...options, timestamps: event.target.checked ? [] : undefined })}
        />
        Timestamps
        {options.timestamps !== undefined && (
          <input
            aria-label="Timestamp values"
            className="w-48 rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 font-mono text-zinc-200"
            defaultValue={options.timestamps.join(', ')}
            placeholder="milliseconds, …"
            onBlur={(event) =>
              update({
                ...options,
                timestamps: event.target.value
                  .split(',')
                  .map((item) => Number(item.trim()))
                  .filter(Number.isFinite)
                  .map((item) => item >>> 0),
              })
            }
          />
        )}
      </label>
    </div>
  );
}
