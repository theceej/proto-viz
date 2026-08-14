import { useId, useMemo, useRef, useState } from 'react';
import { Activity, BarChart2, RotateCcw } from 'lucide-react';
import type { CapturePacket } from '../../../core/capture';
import {
  calculateThroughputBuckets,
  type ThroughputBucket,
} from '../../../core/captureAnalytics';
import type { TimeRangeFilter } from '../../../core/captureFilter';
import {
  formatByteCount,
  formatByteRate,
  formatDuration,
  formatPacketRate,
  formatRelativeTime,
} from './format';

interface ThroughputChartProps {
  packets: CapturePacket[];
  selectedRange: TimeRangeFilter | null;
  onSelectTimeRange: (range: TimeRangeFilter | null) => void;
}

type MetricMode = 'packets' | 'bytes';

const SVG_WIDTH = 1000;
const SVG_HEIGHT = 180;
const PAD_LEFT = 75;
const PAD_RIGHT = 20;
const PAD_TOP = 20;
const PAD_BOTTOM = 30;
const PLOT_WIDTH = SVG_WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_HEIGHT = SVG_HEIGHT - PAD_TOP - PAD_BOTTOM;

export default function ThroughputChart({
  packets,
  selectedRange,
  onSelectTimeRange,
}: ThroughputChartProps) {
  const gradientId = useId();
  const [metric, setMetric] = useState<MetricMode>('packets');
  const [hoveredBucket, setHoveredBucket] = useState<ThroughputBucket | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  // Brush / Drag state
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragStartPx, setDragStartPx] = useState<number | null>(null);
  const [dragCurrentPx, setDragCurrentPx] = useState<number | null>(null);

  const summary = useMemo(() => calculateThroughputBuckets(packets), [packets]);

  const maxVal = metric === 'packets' ? summary.maxPacketsPerSec : summary.maxBytesPerSec;
  const avgVal = metric === 'packets' ? summary.avgPacketsPerSec : summary.avgBytesPerSec;

  const getSvgX = (e: React.PointerEvent<SVGSVGElement>): number => {
    if (!svgRef.current) return 0;
    const rect = svgRef.current.getBoundingClientRect();
    const rawX = ((e.clientX - rect.left) / rect.width) * SVG_WIDTH;
    return Math.max(PAD_LEFT, Math.min(PAD_LEFT + PLOT_WIDTH, rawX));
  };

  const pxToUsec = (px: number): number => {
    const ratio = Math.max(0, Math.min(1, (px - PAD_LEFT) / PLOT_WIDTH));
    return summary.firstUsec + ratio * summary.durationUsec;
  };

  const usecToPx = (usec: number): number => {
    if (summary.durationUsec <= 0) return PAD_LEFT;
    const ratio = Math.max(0, Math.min(1, (usec - summary.firstUsec) / summary.durationUsec));
    return PAD_LEFT + ratio * PLOT_WIDTH;
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (packets.length === 0) return;
    const x = getSvgX(e);
    setDragStartPx(x);
    setDragCurrentPx(x);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const x = getSvgX(e);
    if (dragStartPx !== null) {
      setDragCurrentPx(x);
    } else if (summary.buckets.length > 0) {
      // Find hovered bucket
      const usec = pxToUsec(x);
      const bucket = summary.buckets.find((b) => usec >= b.startUsec && usec <= b.endUsec);
      setHoveredBucket(bucket ?? null);
      if (svgRef.current) {
        const rect = svgRef.current.getBoundingClientRect();
        setHoverPos({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
      }
    }
  };

  const handlePointerUp = () => {
    if (dragStartPx !== null && dragCurrentPx !== null) {
      const dist = Math.abs(dragCurrentPx - dragStartPx);
      if (dist >= 6) {
        const u1 = pxToUsec(Math.min(dragStartPx, dragCurrentPx));
        const u2 = pxToUsec(Math.max(dragStartPx, dragCurrentPx));
        onSelectTimeRange({ minUsec: u1, maxUsec: u2 });
      } else {
        // Single click: find bucket clicked
        const usec = pxToUsec(dragStartPx);
        const bucket = summary.buckets.find((b) => usec >= b.startUsec && usec <= b.endUsec);
        if (bucket) {
          onSelectTimeRange({ minUsec: bucket.startUsec, maxUsec: bucket.endUsec });
        }
      }
    }
    setDragStartPx(null);
    setDragCurrentPx(null);
  };

  const handlePointerLeave = () => {
    if (dragStartPx === null) {
      setHoveredBucket(null);
      setHoverPos(null);
    }
  };

  if (packets.length === 0) return null;

  const bucketCount = summary.buckets.length;
  const barWidth = Math.max(2, PLOT_WIDTH / Math.max(1, bucketCount) - 1.5);

  // Area path generator
  const areaPoints: string[] = [];
  const linePoints: string[] = [];
  if (bucketCount > 0) {
    areaPoints.push(`${PAD_LEFT},${PAD_TOP + PLOT_HEIGHT}`);
    summary.buckets.forEach((b, i) => {
      const bx = PAD_LEFT + (i + 0.5) * (PLOT_WIDTH / bucketCount);
      const val = metric === 'packets' ? b.packetsPerSec : b.bytesPerSec;
      const h = maxVal > 0 ? (val / maxVal) * PLOT_HEIGHT : 0;
      const by = PAD_TOP + PLOT_HEIGHT - h;
      areaPoints.push(`${bx.toFixed(1)},${by.toFixed(1)}`);
      linePoints.push(`${bx.toFixed(1)},${by.toFixed(1)}`);
    });
    areaPoints.push(`${PAD_LEFT + PLOT_WIDTH},${PAD_TOP + PLOT_HEIGHT}`);
  }

  // Active selection highlight bounds
  const selMinPx = selectedRange ? usecToPx(selectedRange.minUsec) : null;
  const selMaxPx = selectedRange ? usecToPx(selectedRange.maxUsec) : null;

  // Active drag selection bounds
  const dragMinPx =
    dragStartPx !== null && dragCurrentPx !== null ? Math.min(dragStartPx, dragCurrentPx) : null;
  const dragMaxPx =
    dragStartPx !== null && dragCurrentPx !== null ? Math.max(dragStartPx, dragCurrentPx) : null;

  return (
    <section
      aria-label="Capture throughput analytics"
      className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4"
    >
      {/* Header controls & summary stats */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 pb-3">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-cyan-400" aria-hidden />
          <h2 className="text-[13px] font-semibold text-zinc-100">Traffic Throughput</h2>
          <span className="text-[11px] text-zinc-500">
            {summary.totalPackets} packets · {formatByteCount(summary.totalBytes)} ·{' '}
            {formatDuration(summary.durationUsec)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {selectedRange && (
            <button
              type="button"
              className="flex cursor-pointer items-center gap-1 rounded-md border border-cyan-800 bg-cyan-950/60 px-2 py-1 text-[11px] text-cyan-300 hover:bg-cyan-900/40"
              onClick={() => onSelectTimeRange(null)}
            >
              <RotateCcw className="size-3" aria-hidden />
              Reset time filter
            </button>
          )}

          <div className="flex rounded-md border border-zinc-700 bg-zinc-950 p-0.5" role="radiogroup" aria-label="Throughput Metric">
            <button
              type="button"
              role="radio"
              aria-checked={metric === 'packets'}
              className={`cursor-pointer rounded px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                metric === 'packets'
                  ? 'bg-cyan-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              onClick={() => setMetric('packets')}
            >
              Packets/sec
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={metric === 'bytes'}
              className={`cursor-pointer rounded px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                metric === 'bytes'
                  ? 'bg-cyan-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              onClick={() => setMetric('bytes')}
            >
              Bytes/sec
            </button>
          </div>
        </div>
      </div>

      {/* Metric summary readout pills */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-1.5">
          <div className="text-[10px] tracking-wider text-zinc-500 uppercase">Peak Rate</div>
          <div className="font-mono text-[13px] font-semibold text-cyan-400">
            {metric === 'packets' ? formatPacketRate(maxVal) : formatByteRate(maxVal)}
          </div>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-1.5">
          <div className="text-[10px] tracking-wider text-zinc-500 uppercase">Average Rate</div>
          <div className="font-mono text-[13px] font-semibold text-zinc-200">
            {metric === 'packets' ? formatPacketRate(avgVal) : formatByteRate(avgVal)}
          </div>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-1.5">
          <div className="text-[10px] tracking-wider text-zinc-500 uppercase">Total Volume</div>
          <div className="font-mono text-[13px] font-semibold text-zinc-200">
            {formatByteCount(summary.totalBytes)}
          </div>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-1.5">
          <div className="text-[10px] tracking-wider text-zinc-500 uppercase">Timespan</div>
          <div className="font-mono text-[13px] font-semibold text-zinc-200">
            {formatDuration(summary.durationUsec)}
          </div>
        </div>
      </div>

      {/* Interactive Chart Canvas */}
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          className="h-44 w-full cursor-crosshair select-none touch-none"
          role="img"
          aria-label={`Time series throughput chart showing ${metric === 'packets' ? 'packets per second' : 'bytes per second'}. Drag to filter time range.`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerLeave}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-cyan-500)" stopOpacity="0.45" />
              <stop offset="100%" stopColor="var(--color-cyan-500)" stopOpacity="0.03" />
            </linearGradient>
          </defs>

          {/* Grid lines & Y-axis labels */}
          {[1, 0.5, 0].map((pct) => {
            const y = PAD_TOP + (1 - pct) * PLOT_HEIGHT;
            const val = pct * maxVal;
            const label = metric === 'packets' ? formatPacketRate(val) : formatByteRate(val);
            return (
              <g key={pct}>
                <line
                  x1={PAD_LEFT}
                  y1={y}
                  x2={PAD_LEFT + PLOT_WIDTH}
                  y2={y}
                  stroke="var(--color-zinc-800)"
                  strokeDasharray={pct === 0 ? undefined : '3 3'}
                  strokeWidth={1}
                />
                <text
                  x={PAD_LEFT - 8}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-zinc-500 font-mono text-[9px]"
                >
                  {label}
                </text>
              </g>
            );
          })}

          {/* Area fill under curve */}
          {areaPoints.length > 0 && (
            <polygon
              points={areaPoints.join(' ')}
              fill={`url(#${gradientId})`}
            />
          )}

          {/* Bars */}
          {summary.buckets.map((b, i) => {
            const bx = PAD_LEFT + i * (PLOT_WIDTH / bucketCount);
            const val = metric === 'packets' ? b.packetsPerSec : b.bytesPerSec;
            const h = maxVal > 0 ? (val / maxVal) * PLOT_HEIGHT : 0;
            const by = PAD_TOP + PLOT_HEIGHT - h;
            const isHovered = hoveredBucket?.index === b.index;
            return (
              <rect
                key={b.index}
                x={bx}
                y={by}
                width={barWidth}
                height={Math.max(1, h)}
                fill={isHovered ? 'var(--color-cyan-300)' : 'var(--color-cyan-500)'}
                opacity={isHovered ? 1 : 0.75}
                rx={1}
              />
            );
          })}

          {/* Line stroke over peaks */}
          {linePoints.length > 0 && (
            <polyline
              points={linePoints.join(' ')}
              fill="none"
              stroke="var(--color-cyan-400)"
              strokeWidth={1.5}
            />
          )}

          {/* Active selection range shadow overlay */}
          {selMinPx !== null && selMaxPx !== null && (
            <g aria-hidden="true">
              <rect
                x={selMinPx}
                y={PAD_TOP}
                width={Math.max(2, selMaxPx - selMinPx)}
                height={PLOT_HEIGHT}
                fill="var(--color-cyan-500)"
                fillOpacity={0.18}
                stroke="var(--color-cyan-400)"
                strokeWidth={1.5}
              />
            </g>
          )}

          {/* Dragging brush overlay */}
          {dragMinPx !== null && dragMaxPx !== null && dragMaxPx > dragMinPx && (
            <g aria-hidden="true">
              <rect
                x={dragMinPx}
                y={PAD_TOP}
                width={dragMaxPx - dragMinPx}
                height={PLOT_HEIGHT}
                fill="var(--color-cyan-400)"
                fillOpacity={0.25}
                stroke="var(--color-cyan-300)"
                strokeWidth={2}
                strokeDasharray="4 2"
              />
            </g>
          )}

          {/* Hover indicator crosshair line */}
          {hoveredBucket && dragStartPx === null && (
            <line
              x1={PAD_LEFT + (hoveredBucket.index + 0.5) * (PLOT_WIDTH / bucketCount)}
              y1={PAD_TOP}
              x2={PAD_LEFT + (hoveredBucket.index + 0.5) * (PLOT_WIDTH / bucketCount)}
              y2={PAD_TOP + PLOT_HEIGHT}
              stroke="var(--color-cyan-300)"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
          )}

          {/* X-axis labels */}
          <text
            x={PAD_LEFT}
            y={SVG_HEIGHT - 8}
            textAnchor="start"
            className="fill-zinc-500 font-mono text-[9px]"
          >
            {formatRelativeTime(summary.firstUsec)}s
          </text>
          <text
            x={PAD_LEFT + PLOT_WIDTH / 2}
            y={SVG_HEIGHT - 8}
            textAnchor="middle"
            className="fill-zinc-500 font-mono text-[9px]"
          >
            {formatRelativeTime(summary.firstUsec + summary.durationUsec / 2)}s
          </text>
          <text
            x={PAD_LEFT + PLOT_WIDTH}
            y={SVG_HEIGHT - 8}
            textAnchor="end"
            className="fill-zinc-500 font-mono text-[9px]"
          >
            {formatRelativeTime(summary.lastUsec)}s
          </text>
        </svg>

        {/* Hover Tooltip Card */}
        {hoveredBucket && hoverPos && dragStartPx === null && (
          <div
            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-md border border-cyan-800/80 bg-zinc-950/95 p-2 shadow-xl font-mono text-[11px] backdrop-blur"
            style={{
              left: Math.max(90, Math.min(window.innerWidth - 100, hoverPos.x)),
              top: Math.max(10, hoverPos.y - 12),
            }}
          >
            <div className="font-semibold text-cyan-300">
              {formatRelativeTime(hoveredBucket.startUsec)}s – {formatRelativeTime(hoveredBucket.endUsec)}s
            </div>
            <div className="mt-1 flex flex-col gap-0.5 text-zinc-300">
              <div>
                Rate:{' '}
                <span className="font-medium text-zinc-100">
                  {formatPacketRate(hoveredBucket.packetsPerSec)} · {formatByteRate(hoveredBucket.bytesPerSec)}
                </span>
              </div>
              <div>
                Count:{' '}
                <span className="font-medium text-zinc-100">
                  {hoveredBucket.packetCount} pkts ({formatByteCount(hoveredBucket.byteCount)})
                </span>
              </div>
              {hoveredBucket.dominantProtocol && (
                <div className="text-[10px] text-zinc-400">
                  Top protocol: <span className="text-cyan-400">{hoveredBucket.dominantProtocol}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-[11px] text-zinc-500">
        <span className="flex items-center gap-1.5">
          <BarChart2 className="size-3.5" aria-hidden />
          Click or drag across timeline to filter packet table
        </span>
        {selectedRange && (
          <span className="font-mono text-cyan-400">
            Window: {(selectedRange.minUsec / 1_000_000).toFixed(4)}s –{' '}
            {(selectedRange.maxUsec / 1_000_000).toFixed(4)}s
          </span>
        )}
      </div>
    </section>
  );
}
