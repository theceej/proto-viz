import { describe, expect, it } from 'vitest';
import type { CapturePacket } from '../../../core/capture';
import {
  aggregateTimelinePackets,
  MAX_TIMELINE_TICKS,
} from './CaptureTimeline';

const packet = (number: number, relativeUsec: number, topProtocol = 'TCP') =>
  ({ number, relativeUsec, topProtocol }) as CapturePacket;

describe('aggregateTimelinePackets', () => {
  it('keeps every packet and its identity for small captures', () => {
    const packets = [packet(1, 0), packet(2, 10), packet(3, 1_000, 'DNS')];

    expect(aggregateTimelinePackets(packets, 2)).toBe(packets);
  });

  it('bounds a 2,000-packet timeline while retaining its time-gap shape', () => {
    const packets = Array.from({ length: 2_000 }, (_, index) =>
      packet(index + 1, index < 1_000 ? index : 1_000_000 + index),
    );
    const ticks = aggregateTimelinePackets(packets, null);

    expect(ticks.length).toBeLessThanOrEqual(MAX_TIMELINE_TICKS);
    expect(ticks[0]!.relativeUsec).toBe(0);
    expect(ticks.some((tick) => tick.relativeUsec < 1_000)).toBe(true);
    expect(ticks.some((tick) => tick.relativeUsec > 1_000_000)).toBe(true);
    expect(ticks.every((tick) => tick.relativeUsec < 1_000 || tick.relativeUsec > 1_000_000)).toBe(true);
  });

  it('uses the selected packet as its bucket representative', () => {
    const packets = Array.from({ length: 2_000 }, (_, index) =>
      packet(index + 1, index, index % 2 === 0 ? 'TCP' : 'DNS'),
    );
    const selected = packets[1_234]!;
    const ticks = aggregateTimelinePackets(packets, selected.number);

    expect(ticks).toContain(selected);
    expect(ticks.find((tick) => tick.number === selected.number)?.topProtocol).toBe(
      selected.topProtocol,
    );
  });
});
