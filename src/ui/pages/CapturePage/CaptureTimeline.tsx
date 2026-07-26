import { useMemo } from 'react';
import type { CapturePacket } from '../../../core/capture';
import { layerColor, PAYLOAD_COLOR } from '../../colors';
import { formatDuration } from './format';

/**
 * The capture as a time axis: one tick per matching packet, placed by its
 * capture time and coloured by its top protocol. This is what a packet list
 * alone cannot show — bursts, gaps, and retransmission clusters are shape,
 * not rows.
 *
 * Ticks are a pointer shortcut, not the accessible control: with up to a
 * couple of thousand packets they would be that many tab stops, and the
 * packet list already exposes every packet as a keyboard-operable row. The
 * strip therefore describes itself as an image and defers navigation to the
 * table below it.
 */
const HEIGHT = 40;
const TICK_WIDTH = 3;
export const MAX_TIMELINE_TICKS = 500;

/** Reduce dense timelines to one representative packet per visual time bucket. */
export function aggregateTimelinePackets(
  packets: CapturePacket[],
  selected: number | null,
  maxTicks = MAX_TIMELINE_TICKS,
): CapturePacket[] {
  if (packets.length <= maxTicks) return packets;
  const first = packets.reduce((min, packet) => Math.min(min, packet.relativeUsec), Infinity);
  const last = packets.reduce((max, packet) => Math.max(max, packet.relativeUsec), -Infinity);
  const width = Math.max(1, last - first);
  const buckets = new Map<number, CapturePacket>();
  for (const packet of packets) {
    const bucket = Math.min(
      maxTicks - 1,
      Math.floor(((packet.relativeUsec - first) / width) * maxTicks),
    );
    if (!buckets.has(bucket) || packet.number === selected) buckets.set(bucket, packet);
  }
  return [...buckets.values()];
}

export default function CaptureTimeline({
  packets,
  selected,
  onSelect,
}: {
  packets: CapturePacket[];
  selected: number | null;
  onSelect: (packetNumber: number) => void;
}) {
  const { span, colors } = useMemo(() => {
    const last = packets.reduce((max, p) => Math.max(max, p.relativeUsec), 0);
    const first = packets.reduce((min, p) => Math.min(min, p.relativeUsec), last);
    // Distinct top protocols get distinct hues, assigned in first-seen order.
    const order: string[] = [];
    for (const packet of packets) {
      if (!order.includes(packet.topProtocol)) order.push(packet.topProtocol);
    }
    return {
      span: { first, last, width: Math.max(1, last - first) },
      colors: new Map(order.map((name, i) => [name, layerColor(i).accent])),
    };
  }, [packets]);
  const ticks = useMemo(
    () => aggregateTimelinePackets(packets, selected),
    [packets, selected],
  );

  if (packets.length === 0) return null;

  const duration = span.last - span.first;

  return (
    <section
      aria-label="Capture timeline"
      className="border-b border-zinc-800 bg-zinc-900/30 px-6 py-2"
    >
      <svg
        viewBox={`0 0 1000 ${HEIGHT}`}
        preserveAspectRatio="none"
        className="h-10 w-full"
        role="img"
        aria-label={`${packets.length} packets over ${formatDuration(duration)}. Use the packet list below to select one.`}
      >
        <line
          x1={0}
          y1={HEIGHT - 6}
          x2={1000}
          y2={HEIGHT - 6}
          stroke="var(--color-zinc-700)"
          strokeWidth={1}
        />
        {ticks.map((packet) => {
          const x = ((packet.relativeUsec - span.first) / span.width) * (1000 - TICK_WIDTH);
          const isSelected = packet.number === selected;
          return (
            <rect
              key={packet.number}
              x={x}
              y={isSelected ? 2 : 8}
              width={TICK_WIDTH}
              height={isSelected ? HEIGHT - 10 : HEIGHT - 16}
              className="cursor-pointer"
              fill={
                isSelected
                  ? 'var(--color-cyan-400)'
                  : (colors.get(packet.topProtocol) ?? PAYLOAD_COLOR.accent)
              }
              opacity={isSelected ? 1 : 0.75}
              onClick={() => onSelect(packet.number)}
            >
              <title>{`#${packet.number} ${packet.topProtocol} — ${packet.summary}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="flex justify-between font-mono text-[10px] text-zinc-600">
        <span>0.000000</span>
        <span aria-hidden>{formatDuration(duration)}</span>
        <span>{(span.last / 1_000_000).toFixed(6)}</span>
      </div>
    </section>
  );
}
