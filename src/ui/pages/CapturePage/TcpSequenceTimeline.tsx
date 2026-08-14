import { useMemo, useState } from 'react';
import { GitCommit, Info, Network } from 'lucide-react';
import type { CapturePacket } from '../../../core/capture';
import type { Flow } from '../../../core/flows';
import {
  calculateStevensPlot,
  type StevensPlotData,
  type TcpPacketPoint,
} from '../../../core/captureAnalytics';
import { formatByteCount, formatDuration, formatRelativeTime } from './format';

interface TcpSequenceTimelineProps {
  packets: CapturePacket[];
  flows: Flow[];
  selectedPacket: number | null;
  onSelectPacket: (packetNumber: number) => void;
}

type DirectionFilter = 'all' | 'forward' | 'reverse';

const SVG_WIDTH = 1000;
const SVG_HEIGHT = 240;
const PAD_LEFT = 90;
const PAD_RIGHT = 30;
const PAD_TOP = 25;
const PAD_BOTTOM = 35;
const PLOT_WIDTH = SVG_WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_HEIGHT = SVG_HEIGHT - PAD_TOP - PAD_BOTTOM;

export default function TcpSequenceTimeline({
  packets,
  flows,
  selectedPacket,
  onSelectPacket,
}: TcpSequenceTimelineProps) {
  // Find all TCP flows
  const tcpFlows = useMemo(
    () => flows.filter((f) => f.protocols.some((p) => p.toLowerCase().includes('tcp'))),
    [flows],
  );

  const [selectedFlowKey, setSelectedFlowKey] = useState<string | null>(null);
  const [relativeSeq, setRelativeSeq] = useState(true);
  const [dirFilter, setDirFilter] = useState<DirectionFilter>('all');
  const [hoveredPoint, setHoveredPoint] = useState<TcpPacketPoint | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  const activeFlow =
    tcpFlows.find((f) => f.key === selectedFlowKey) ?? tcpFlows[0] ?? null;

  const plotData: StevensPlotData | null = useMemo(() => {
    if (!activeFlow) return null;
    return calculateStevensPlot(packets, activeFlow);
  }, [packets, activeFlow]);

  if (tcpFlows.length === 0) {
    return (
      <section
        aria-label="TCP sequence analysis"
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-8 text-center"
      >
        <Network className="size-6 text-zinc-600" aria-hidden />
        <h2 className="text-[13px] font-semibold text-zinc-300">No TCP Streams Found</h2>
        <p className="max-w-md text-[11px] text-zinc-500">
          This capture does not contain any TCP conversations. Open a capture with TCP traffic to view
          Stevens-style sequence number and ACK progression plots.
        </p>
      </section>
    );
  }

  if (!plotData || !plotData.hasData || !activeFlow) {
    return (
      <section
        aria-label="TCP sequence analysis"
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-8 text-center"
      >
        <Info className="size-6 text-zinc-600" aria-hidden />
        <p className="text-[12px] text-zinc-400">No TCP packets found in the selected flow.</p>
      </section>
    );
  }

  // Filter points by direction
  const visiblePoints = plotData.points.filter((p) => {
    if (dirFilter === 'forward') return p.direction === 'forward';
    if (dirFilter === 'reverse') return p.direction === 'reverse';
    return true;
  });

  // Calculate Y-scale (max sequence / ack)
  const maxSeqVal = Math.max(
    1,
    relativeSeq
      ? Math.max(plotData.maxSeqForward, plotData.maxSeqReverse, plotData.maxAckForward, plotData.maxAckReverse)
      : Math.max(...plotData.points.map((p) => Math.max(p.seq, p.ack ?? 0))),
  );

  const minSeqVal = relativeSeq
    ? 0
    : Math.min(...plotData.points.map((p) => Math.min(p.seq, p.ack ?? p.seq)));

  const seqSpan = Math.max(1, maxSeqVal - minSeqVal);

  const timeSpanUsec = Math.max(1, plotData.lastUsec - plotData.firstUsec);

  const getX = (usec: number) => {
    const ratio = Math.max(0, Math.min(1, (usec - plotData.firstUsec) / timeSpanUsec));
    return PAD_LEFT + ratio * PLOT_WIDTH;
  };

  const getY = (val: number) => {
    const ratio = Math.max(0, Math.min(1, (val - minSeqVal) / seqSpan));
    return PAD_TOP + PLOT_HEIGHT - ratio * PLOT_HEIGHT;
  };

  return (
    <section
      aria-label="TCP Sequence & ACK timeline"
      className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4"
    >
      {/* Header controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <GitCommit className="size-4 text-cyan-400" aria-hidden />
            <h2 className="text-[13px] font-semibold text-zinc-100">TCP Stream Timeline</h2>
          </div>

          {/* Flow selector dropdown */}
          <select
            className="cursor-pointer rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-200 outline-none focus:border-cyan-600"
            aria-label="Select TCP Flow"
            value={activeFlow.key}
            onChange={(e) => setSelectedFlowKey(e.target.value)}
          >
            {tcpFlows.map((f) => (
              <option key={f.key} value={f.key}>
                {f.initiator.address}:{f.initiator.port} ↔ {f.responder.address}:{f.responder.port} ({f.packetCount} pkts)
              </option>
            ))}
          </select>
        </div>

        {/* View Options */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Direction Filter */}
          <div className="flex rounded-md border border-zinc-700 bg-zinc-950 p-0.5" role="radiogroup" aria-label="Direction">
            <button
              type="button"
              role="radio"
              aria-checked={dirFilter === 'all'}
              className={`cursor-pointer rounded px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
                dirFilter === 'all'
                  ? 'bg-cyan-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              onClick={() => setDirFilter('all')}
            >
              Both
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={dirFilter === 'forward'}
              className={`cursor-pointer rounded px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
                dirFilter === 'forward'
                  ? 'bg-cyan-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              onClick={() => setDirFilter('forward')}
            >
              Initiator →
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={dirFilter === 'reverse'}
              className={`cursor-pointer rounded px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
                dirFilter === 'reverse'
                  ? 'bg-cyan-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              onClick={() => setDirFilter('reverse')}
            >
              ← Responder
            </button>
          </div>

          {/* Relative vs Absolute Seq */}
          <button
            type="button"
            className={`cursor-pointer rounded border px-2 py-1 text-[11px] font-medium transition-colors ${
              relativeSeq
                ? 'border-cyan-700 bg-cyan-950/60 text-cyan-300'
                : 'border-zinc-700 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
            }`}
            onClick={() => setRelativeSeq(!relativeSeq)}
          >
            {relativeSeq ? 'Relative Seq # (ISN=0)' : 'Raw 32-bit Seq #'}
          </button>
        </div>
      </div>

      {/* Legend & Stream Summary */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-cyan-400" />
            <span className="font-mono text-zinc-300">{plotData.initiatorAddress} (Initiator)</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-amber-400" />
            <span className="font-mono text-zinc-300">{plotData.responderAddress} (Responder)</span>
          </span>
          <span className="flex items-center gap-1.5 text-zinc-400">
            <span className="inline-block size-1.5 rounded-full bg-emerald-400" />
            <span>ACK</span>
          </span>
        </div>

        <div className="font-mono text-zinc-500">
          {plotData.points.length} packets · {formatDuration(plotData.durationUsec)}
        </div>
      </div>

      {/* SVG Stevens Sequence Plot */}
      <div className="relative">
        <svg
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          className="h-56 w-full cursor-pointer select-none"
          role="img"
          aria-label="Stevens sequence number versus time plot for TCP flow"
          onMouseLeave={() => {
            setHoveredPoint(null);
            setHoverPos(null);
          }}
        >
          {/* Background & Grid */}
          <rect
            x={PAD_LEFT}
            y={PAD_TOP}
            width={PLOT_WIDTH}
            height={PLOT_HEIGHT}
            fill="var(--color-zinc-950)"
            stroke="var(--color-zinc-800)"
            strokeWidth={1}
          />

          {/* Horizontal Gridlines & Y-labels */}
          {[1, 0.75, 0.5, 0.25, 0].map((pct) => {
            const y = PAD_TOP + (1 - pct) * PLOT_HEIGHT;
            const val = minSeqVal + pct * seqSpan;
            return (
              <g key={pct}>
                <line
                  x1={PAD_LEFT}
                  y1={y}
                  x2={PAD_LEFT + PLOT_WIDTH}
                  y2={y}
                  stroke="var(--color-zinc-800)"
                  strokeDasharray="2 2"
                  strokeWidth={1}
                />
                <text
                  x={PAD_LEFT - 8}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-zinc-500 font-mono text-[9px]"
                >
                  {val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val.toFixed(0)}
                </text>
              </g>
            );
          })}

          {/* Data Segments & Packet Points */}
          {visiblePoints.map((pt) => {
            const x = getX(pt.relativeUsec);
            const seqVal = relativeSeq ? pt.relSeq : pt.seq;
            const y = getY(seqVal);
            const isForward = pt.direction === 'forward';
            const color = isForward ? 'var(--color-cyan-400)' : 'var(--color-amber-400)';
            const isSelected = selectedPacket === pt.packetNumber;
            const isHovered = hoveredPoint?.packetNumber === pt.packetNumber;

            const payloadLen = pt.payloadLength;
            const hasData = payloadLen > 0;
            const endSeqVal = seqVal + (hasData ? payloadLen : (pt.flags.syn || pt.flags.fin ? 1 : 0));
            const yEnd = getY(endSeqVal);

            return (
              <g
                key={pt.packetNumber}
                className="cursor-pointer"
                onClick={() => onSelectPacket(pt.packetNumber)}
                onMouseEnter={(e) => {
                  setHoveredPoint(pt);
                  const rect = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
                  if (rect) {
                    setHoverPos({
                      x: e.clientX - rect.left,
                      y: e.clientY - rect.top,
                    });
                  }
                }}
              >
                {/* Data segment line/bar */}
                {hasData && (
                  <line
                    x1={x}
                    y1={y}
                    x2={x}
                    y2={yEnd}
                    stroke={color}
                    strokeWidth={isSelected || isHovered ? 4 : 2}
                    opacity={isSelected || isHovered ? 1 : 0.85}
                  />
                )}

                {/* Packet Seq Point */}
                <circle
                  cx={x}
                  cy={y}
                  r={isSelected ? 5 : isHovered ? 4 : 3}
                  fill={color}
                  stroke={isSelected ? 'white' : 'var(--color-zinc-900)'}
                  strokeWidth={isSelected ? 2 : 1}
                />

                {/* ACK Point (if ACK present) */}
                {pt.ack !== null && (
                  <circle
                    cx={x}
                    cy={getY(relativeSeq ? (pt.relAck ?? 0) : pt.ack)}
                    r={isSelected ? 4 : 2.5}
                    fill="var(--color-emerald-400)"
                    opacity={0.8}
                  />
                )}

                {/* Flag label (SYN, FIN, RST) */}
                {(pt.flags.syn || pt.flags.fin || pt.flags.rst) && (
                  <text
                    x={x}
                    y={Math.max(PAD_TOP + 10, y - 6)}
                    textAnchor="middle"
                    className="fill-zinc-300 font-mono text-[8px] font-bold"
                  >
                    {pt.flags.syn && pt.flags.ack
                      ? 'S/A'
                      : pt.flags.syn
                        ? 'SYN'
                        : pt.flags.fin
                          ? 'FIN'
                          : 'RST'}
                  </text>
                )}

                {/* Selected packet vertical crosshair */}
                {isSelected && (
                  <line
                    x1={x}
                    y1={PAD_TOP}
                    x2={x}
                    y2={PAD_TOP + PLOT_HEIGHT}
                    stroke="var(--color-cyan-300)"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                )}
              </g>
            );
          })}

          {/* X-axis labels */}
          <text
            x={PAD_LEFT}
            y={SVG_HEIGHT - 10}
            textAnchor="start"
            className="fill-zinc-500 font-mono text-[9px]"
          >
            {formatRelativeTime(plotData.firstUsec)}s
          </text>
          <text
            x={PAD_LEFT + PLOT_WIDTH / 2}
            y={SVG_HEIGHT - 10}
            textAnchor="middle"
            className="fill-zinc-500 font-mono text-[9px]"
          >
            {formatRelativeTime(plotData.firstUsec + timeSpanUsec / 2)}s
          </text>
          <text
            x={PAD_LEFT + PLOT_WIDTH}
            y={SVG_HEIGHT - 10}
            textAnchor="end"
            className="fill-zinc-500 font-mono text-[9px]"
          >
            {formatRelativeTime(plotData.lastUsec)}s
          </text>
        </svg>

        {/* Hover Tooltip */}
        {hoveredPoint && hoverPos && (
          <div
            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-md border border-zinc-700 bg-zinc-950/95 p-2.5 shadow-xl font-mono text-[11px] backdrop-blur"
            style={{
              left: Math.max(100, Math.min(window.innerWidth - 120, hoverPos.x)),
              top: Math.max(10, hoverPos.y - 12),
            }}
          >
            <div className="flex items-center justify-between gap-4 font-semibold text-zinc-100">
              <span>Packet #{hoveredPoint.packetNumber}</span>
              <span className="text-cyan-400">{formatRelativeTime(hoveredPoint.relativeUsec)}s</span>
            </div>
            <div className="mt-1.5 flex flex-col gap-0.5 text-zinc-300">
              <div>
                Dir:{' '}
                <span className={hoveredPoint.direction === 'forward' ? 'text-cyan-300' : 'text-amber-300'}>
                  {hoveredPoint.direction === 'forward' ? 'Initiator → Responder' : 'Responder → Initiator'}
                </span>
              </div>
              <div>
                Seq:{' '}
                <span className="text-zinc-100">
                  {relativeSeq ? hoveredPoint.relSeq : hoveredPoint.seq}
                  {relativeSeq && ` (raw: ${hoveredPoint.seq})`}
                </span>
              </div>
              {hoveredPoint.ack !== null && (
                <div>
                  Ack:{' '}
                  <span className="text-emerald-400">
                    {relativeSeq ? hoveredPoint.relAck : hoveredPoint.ack}
                    {relativeSeq && ` (raw: ${hoveredPoint.ack})`}
                  </span>
                </div>
              )}
              <div>
                Payload:{' '}
                <span className="text-zinc-100">{formatByteCount(hoveredPoint.payloadLength)}</span>
              </div>
              <div>
                Flags:{' '}
                <span className="rounded bg-zinc-800 px-1 py-0.5 font-semibold text-cyan-300">
                  {hoveredPoint.flagNames.join(' | ') || 'None'}
                </span>
              </div>
              <div className="mt-1 max-w-[200px] truncate text-[10px] text-zinc-400">
                {hoveredPoint.summary}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-[11px] text-zinc-500">
        <span>Click any point or sequence segment to select and inspect the packet below</span>
        {selectedPacket && (
          <span className="font-mono text-cyan-400">Selected packet: #{selectedPacket}</span>
        )}
      </div>
    </section>
  );
}
