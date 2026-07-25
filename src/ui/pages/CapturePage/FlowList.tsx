import { flowLabel, type Flow } from '../../../core/flows';
import { formatByteCount, formatDuration, formatRelativeTime } from './format';

/**
 * The capture's conversations. Selecting one narrows the packet list to that
 * flow, which is the quickest route from "there is a lot here" to "show me
 * this exchange" — and from there to sending two of its packets to Packet
 * Comparison.
 */
export default function FlowList({
  flows,
  activeKey,
  onSelect,
}: {
  flows: Flow[];
  activeKey: string | null;
  onSelect: (flow: Flow) => void;
}) {
  if (flows.length === 0) {
    return (
      <p className="px-6 py-8 text-center text-[13px] text-zinc-500">
        No flows — none of the matching packets had readable addresses.
      </p>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-[12px]">
        <caption className="sr-only">
          Bidirectional flows in the capture. Selecting one filters the packet list.
        </caption>
        <thead className="sticky top-0 z-10 bg-zinc-900">
          <tr className="text-zinc-400">
            <th scope="col" className="border-b border-zinc-800 px-3 py-1.5 text-left font-medium">
              Endpoints
            </th>
            <th scope="col" className="border-b border-zinc-800 px-3 py-1.5 text-left font-medium">
              Protocols
            </th>
            <th scope="col" className="w-24 border-b border-zinc-800 px-3 py-1.5 text-right font-medium">
              Packets
            </th>
            <th scope="col" className="w-24 border-b border-zinc-800 px-3 py-1.5 text-right font-medium">
              Bytes
            </th>
            <th scope="col" className="w-24 border-b border-zinc-800 px-3 py-1.5 text-right font-medium">
              Start
            </th>
            <th scope="col" className="w-24 border-b border-zinc-800 px-3 py-1.5 text-right font-medium">
              Duration
            </th>
          </tr>
        </thead>
        <tbody>
          {flows.map((flow) => {
            const active = flow.key === activeKey;
            return (
              <tr
                key={flow.key}
                className={`border-b border-zinc-900 ${active ? 'bg-cyan-500/15' : 'hover:bg-zinc-800/50'}`}
              >
                <td className="px-3 py-1">
                  <button
                    className="cursor-pointer font-mono text-zinc-200 hover:text-cyan-300"
                    aria-pressed={active}
                    onClick={() => onSelect(flow)}
                  >
                    {flowLabel(flow)}
                  </button>
                </td>
                <td className="truncate px-3 py-1 text-zinc-400" title={flow.protocols.join(' › ')}>
                  {flow.protocols.join(' › ')}
                </td>
                <td className="px-3 py-1 text-right font-mono text-zinc-300">{flow.packetCount}</td>
                <td className="px-3 py-1 text-right font-mono text-zinc-300">
                  {formatByteCount(flow.byteCount)}
                </td>
                <td className="px-3 py-1 text-right font-mono text-zinc-500">
                  {formatRelativeTime(flow.firstUsec)}
                </td>
                <td className="px-3 py-1 text-right font-mono text-zinc-300">
                  {formatDuration(flow.durationUsec)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
