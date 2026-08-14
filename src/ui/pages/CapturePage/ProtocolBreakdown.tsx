import { useMemo, useState } from 'react';
import { Layers, PieChart as PieChartIcon } from 'lucide-react';
import type { CapturePacket } from '../../../core/capture';
import {
  calculateProtocolDistribution,
  type ProtocolShare,
} from '../../../core/captureAnalytics';
import { layerColor } from '../../colors';
import { formatByteCount } from './format';

interface ProtocolBreakdownProps {
  packets: CapturePacket[];
  selectedProtocolId: string | null;
  onSelectProtocol: (protocolId: string | null) => void;
}

type DistributionMetric = 'packets' | 'bytes';
type BreakdownScope = 'top' | 'all';

const DONUT_SIZE = 180;
const RADIUS = 75;
const HOLE_RADIUS = 48;
const CENTER = DONUT_SIZE / 2;

function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function describeArc(
  x: number,
  y: number,
  radius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
) {
  // If full circle
  const sweep = endAngle - startAngle;
  const isFull = sweep >= 359.99;
  const adjEndAngle = isFull ? startAngle + 359.99 : endAngle;

  const start = polarToCartesian(x, y, radius, adjEndAngle);
  const end = polarToCartesian(x, y, radius, startAngle);
  const innerStart = polarToCartesian(x, y, innerRadius, startAngle);
  const innerEnd = polarToCartesian(x, y, innerRadius, adjEndAngle);

  const largeArcFlag = sweep <= 180 ? '0' : '1';

  return [
    'M',
    start.x,
    start.y,
    'A',
    radius,
    radius,
    0,
    largeArcFlag,
    0,
    end.x,
    end.y,
    'L',
    innerStart.x,
    innerStart.y,
    'A',
    innerRadius,
    innerRadius,
    0,
    largeArcFlag,
    1,
    innerEnd.x,
    innerEnd.y,
    'Z',
  ].join(' ');
}

function computeSlices(items: ProtocolShare[], metric: DistributionMetric) {
  let cumulative = 0;
  return items.map((item) => {
    const pct = metric === 'packets' ? item.packetPercentage : item.bytePercentage;
    const angle = (pct / 100) * 360;
    const startAngle = cumulative;
    const endAngle = cumulative + angle;
    cumulative = endAngle;
    return {
      item,
      startAngle,
      endAngle,
      path: describeArc(CENTER, CENTER, RADIUS, HOLE_RADIUS, startAngle, endAngle),
      color: layerColor(item.colorIndex).accent,
    };
  });
}

export default function ProtocolBreakdown({
  packets,
  selectedProtocolId,
  onSelectProtocol,
}: ProtocolBreakdownProps) {
  const [metric, setMetric] = useState<DistributionMetric>('bytes');
  const [scope, setScope] = useState<BreakdownScope>('top');
  const [hoveredProtocol, setHoveredProtocol] = useState<ProtocolShare | null>(null);

  const distribution = useMemo(
    () => calculateProtocolDistribution(packets, scope),
    [packets, scope],
  );

  const items = distribution.items;

  // Compute donut slices
  const slices = useMemo(
    () => computeSlices(items, metric),
    [items, metric],
  );

  if (packets.length === 0) return null;

  const activeItem = hoveredProtocol ?? items.find((i) => i.protocolId === selectedProtocolId) ?? items[0];

  return (
    <section
      aria-label="Protocol breakdown analytics"
      className="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4"
    >
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 pb-3">
        <div className="flex items-center gap-2">
          <Layers className="size-4 text-cyan-400" aria-hidden />
          <h2 className="text-[13px] font-semibold text-zinc-100">Protocol Breakdown</h2>
          <span className="text-[11px] text-zinc-500">
            {items.length} distinct {scope === 'top' ? 'top protocols' : 'layers'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Scope Toggle: Top vs All */}
          <div className="flex rounded-md border border-zinc-700 bg-zinc-950 p-0.5" role="radiogroup" aria-label="Protocol Layer Scope">
            <button
              type="button"
              role="radio"
              aria-checked={scope === 'top'}
              className={`cursor-pointer rounded px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                scope === 'top'
                  ? 'bg-cyan-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              onClick={() => setScope('top')}
            >
              Top Protocol
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={scope === 'all'}
              className={`cursor-pointer rounded px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                scope === 'all'
                  ? 'bg-cyan-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              onClick={() => setScope('all')}
            >
              All Layers
            </button>
          </div>

          {/* Metric Toggle: Packets vs Bytes */}
          <div className="flex rounded-md border border-zinc-700 bg-zinc-950 p-0.5" role="radiogroup" aria-label="Breakdown Metric">
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
              By Bytes
            </button>
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
              By Packets
            </button>
          </div>
        </div>
      </div>

      {/* Main visualization grid */}
      <div className="grid grid-cols-1 items-center gap-6 md:grid-cols-[220px_1fr]">
        {/* Donut Chart */}
        <div className="flex flex-col items-center justify-center">
          <div className="relative size-[180px]">
            <svg
              viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
              className="size-full"
              role="img"
              aria-label="Protocol distribution donut chart"
            >
              {slices.map(({ item, path, color }) => {
                const isSelected = selectedProtocolId === item.protocolId;
                const isHovered = hoveredProtocol?.protocolId === item.protocolId;
                return (
                  <path
                    key={item.protocolId}
                    d={path}
                    fill={color}
                    opacity={isSelected || isHovered ? 1 : 0.8}
                    stroke="var(--color-zinc-950)"
                    strokeWidth={isSelected ? 2 : 1}
                    className="cursor-pointer transition-all duration-150 hover:opacity-100"
                    onMouseEnter={() => setHoveredProtocol(item)}
                    onMouseLeave={() => setHoveredProtocol(null)}
                    onClick={() =>
                      onSelectProtocol(
                        selectedProtocolId === item.protocolId ? null : item.protocolId,
                      )
                    }
                  >
                    <title>{`${item.name}: ${
                      metric === 'packets'
                        ? `${item.packetCount} packets (${item.packetPercentage.toFixed(1)}%)`
                        : `${formatByteCount(item.byteCount)} (${item.bytePercentage.toFixed(1)}%)`
                    }`}</title>
                  </path>
                );
              })}
            </svg>

            {/* Center Summary Text */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              {activeItem ? (
                <>
                  <span className="max-w-[80px] truncate text-[11px] font-semibold text-zinc-100">
                    {activeItem.name}
                  </span>
                  <span className="font-mono text-[13px] font-bold text-cyan-400">
                    {metric === 'packets'
                      ? `${activeItem.packetPercentage.toFixed(1)}%`
                      : `${activeItem.bytePercentage.toFixed(1)}%`}
                  </span>
                  <span className="text-[9px] text-zinc-500">
                    {metric === 'packets'
                      ? `${activeItem.packetCount} pkts`
                      : formatByteCount(activeItem.byteCount)}
                  </span>
                </>
              ) : (
                <PieChartIcon className="size-6 text-zinc-600" aria-hidden />
              )}
            </div>
          </div>

          <div className="mt-1 text-[11px] text-zinc-500">
            {selectedProtocolId ? (
              <button
                type="button"
                className="cursor-pointer text-cyan-400 hover:underline"
                onClick={() => onSelectProtocol(null)}
              >
                Clear protocol filter
              </button>
            ) : (
              'Click slice to filter'
            )}
          </div>
        </div>

        {/* Comparative Bars & Details Table */}
        <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1">
          {items.map((item) => {
            const isSelected = selectedProtocolId === item.protocolId;
            const isHovered = hoveredProtocol?.protocolId === item.protocolId;
            const pct = metric === 'packets' ? item.packetPercentage : item.bytePercentage;
            const color = layerColor(item.colorIndex).accent;

            return (
              <button
                key={item.protocolId}
                type="button"
                className={`group flex cursor-pointer flex-col gap-1 rounded-md border p-2 text-left transition-all ${
                  isSelected
                    ? 'border-cyan-600 bg-cyan-950/40 text-cyan-200'
                    : isHovered
                      ? 'border-zinc-700 bg-zinc-800/60 text-zinc-200'
                      : 'border-zinc-800/80 bg-zinc-950/40 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900/60'
                }`}
                onMouseEnter={() => setHoveredProtocol(item)}
                onMouseLeave={() => setHoveredProtocol(null)}
                onClick={() =>
                  onSelectProtocol(
                    selectedProtocolId === item.protocolId ? null : item.protocolId,
                  )
                }
              >
                <div className="flex items-center justify-between text-[12px]">
                  <div className="flex items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                    <span className="font-medium text-zinc-100">{item.name}</span>
                    <span className="font-mono text-[10px] text-zinc-500 uppercase">
                      {item.protocolId}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[11px]">
                    <span className="text-zinc-400">
                      {metric === 'packets'
                        ? `${item.packetCount.toLocaleString()} pkts`
                        : formatByteCount(item.byteCount)}
                    </span>
                    <span className="w-12 text-right font-semibold text-cyan-400">
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                </div>

                {/* Proportion bar */}
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.max(1, pct)}%`,
                      backgroundColor: color,
                    }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
