import type { LayerHint } from '../../core/model';
import type { Registry } from '../../core/registry';
import { layerColor } from '../colors';

interface OsiRow {
  n: number;
  name: string;
  summary: string;
  /** Library groups whose protocols live at this layer (drives the count). */
  hints: LayerHint[];
  /** Curated example protocol ids, shown as chips when present in the registry. */
  examples: string[];
  /** Library section to jump to, if any. */
  target?: LayerHint;
  note?: string;
}

const ROWS: OsiRow[] = [
  {
    n: 7,
    name: 'Application',
    summary: 'What the traffic is for: names, mail, files, web, telemetry.',
    hints: ['application'],
    examples: ['dns', 'http1', 'smtp', 'dhcp', 'mqtt'],
    target: 'application',
  },
  {
    n: 6,
    name: 'Presentation',
    summary: 'Encoding and encryption of the data in transit.',
    hints: [],
    examples: ['tls'],
    target: 'application',
    note: 'Rarely a separate protocol today — TLS is the closest thing.',
  },
  {
    n: 5,
    name: 'Session',
    summary: 'Setting up, holding, and tearing down conversations.',
    hints: [],
    examples: ['sip', 'rtsp', 'smb2'],
    target: 'application',
    note: 'Usually folded into the application protocol itself.',
  },
  {
    n: 4,
    name: 'Transport',
    summary: 'End-to-end delivery between programs: ports, reliability, ordering.',
    hints: ['transport'],
    examples: ['tcp', 'udp', 'sctp'],
    target: 'transport',
  },
  {
    n: 3,
    name: 'Network',
    summary: 'Addressing and routing between networks.',
    hints: ['network'],
    examples: ['ipv4', 'ipv6', 'icmp', 'ospf', 'bgp'],
    target: 'network',
  },
  {
    n: 2,
    name: 'Data Link',
    summary: 'Framing and delivery on one link or LAN segment.',
    hints: ['link'],
    examples: ['ethernet', 'vlan-8021q', 'stp', 'lldp'],
    target: 'link',
  },
  {
    n: 1,
    name: 'Physical',
    summary: 'Bits as volts, radio, and light.',
    hints: [],
    examples: [],
    note: 'Below packet headers — nothing to model here.',
  },
];

/**
 * Toggleable OSI reference panel: maps the seven layers onto this library's
 * groups, with live protocol counts. Clicking a layer jumps to its section.
 */
export default function OsiModel({
  registry,
  onJump,
}: {
  registry: Registry;
  onJump: (target: LayerHint) => void;
}) {
  const all = registry.all();

  return (
    <div
      role="region"
      aria-label="OSI reference model"
      className="border-b border-zinc-800 px-6 py-4"
    >
      <div className="flex max-w-3xl flex-col gap-1">
        {ROWS.map((row) => {
          const color = layerColor(7 - row.n);
          const count = all.filter((p) => row.hints.includes(p.layerHint)).length;
          const chips = row.examples
            .map((id) => registry.get(id))
            .filter((p) => p !== undefined);
          const extra = count - chips.length;
          const body = (
            <>
              <span
                className="grid size-6 shrink-0 place-items-center rounded font-mono text-[12px] font-bold text-zinc-100"
                style={{ background: color.fill, boxShadow: `inset 0 0 0 1px ${color.border}` }}
                aria-hidden
              >
                {row.n}
              </span>
              <span className="w-24 shrink-0 text-left text-[13px] font-semibold text-zinc-100">
                {row.name}
              </span>
              <span className="min-w-0 flex-1 text-left text-[12px] text-zinc-500">
                {row.summary}
                {row.note && <span className="text-zinc-600"> {row.note}</span>}
              </span>
              <span className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1">
                {chips.map((p) => (
                  <span
                    key={p.id}
                    className="rounded px-1.5 py-0.5 font-mono text-[10px] text-zinc-200"
                    style={{ background: color.fill }}
                  >
                    {p.name}
                  </span>
                ))}
                {extra > 0 && (
                  <span className="font-mono text-[10px] text-zinc-500">+{extra} more</span>
                )}
              </span>
            </>
          );

          return row.target ? (
            <button
              key={row.n}
              className="flex cursor-pointer items-center gap-3 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900"
              aria-label={`Layer ${row.n}, ${row.name} — jump to those protocols`}
              onClick={() => onJump(row.target!)}
            >
              {body}
            </button>
          ) : (
            <div key={row.n} className="flex items-center gap-3 px-2 py-1.5">
              {body}
            </div>
          );
        })}
        <p className="mt-1 px-2 text-[11px] text-zinc-600">
          Tunnels (GRE, VXLAN, GTP-U, WireGuard…) wrap one stack inside another, so
          they sit between layers rather than at one — the library groups them
          separately.
        </p>
      </div>
    </div>
  );
}
