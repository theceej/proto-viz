import { useMemo } from 'react';
import type { SerializedPacket } from '../../core/serialize';
import { buildSpanIndex } from '../../core/spanIndex';
import { isActive, useHighlightStore, type FieldRef } from '../../store/highlightStore';
import { layerColor, PAYLOAD_COLOR, type LayerColor } from '../colors';

/** Full-packet hex dump with layer tints and field hover-linking. */
export default function HexView({ packet }: { packet: SerializedPacket }) {
  const { setHovered, toggleLocked } = useHighlightStore();
  const hovered = useHighlightStore((s) => s.hovered);
  const locked = useHighlightStore((s) => s.locked);

  const spanIndex = useMemo(
    () => buildSpanIndex(packet.spans, packet.bytes.length),
    [packet],
  );

  const layerOfByte = useMemo(() => {
    const arr: number[] = new Array(packet.bytes.length).fill(-1); // -1 = payload
    packet.layers.forEach((l, i) => {
      for (let b = l.byteOffset; b < l.byteOffset + l.headerBytes; b++) arr[b] = i;
    });
    return arr;
  }, [packet]);

  const rows = [];
  for (let off = 0; off < packet.bytes.length; off += 16) rows.push(off);
  if (packet.bytes.length === 0) {
    return <div className="p-4 text-xs text-zinc-600 italic">empty packet</div>;
  }

  const byteActive = (b: number): boolean =>
    spanIndex[b]!.some(
      (s) =>
        isActive(hovered, s.layerUid, s.fieldId) || isActive(locked, s.layerUid, s.fieldId),
    );

  const refOfByte = (b: number): FieldRef | null => {
    const s = spanIndex[b]![0];
    return s ? { layerUid: s.layerUid, fieldId: s.fieldId } : null;
  };

  const colorOfByte = (b: number): LayerColor =>
    layerOfByte[b]! >= 0 ? layerColor(layerOfByte[b]!) : PAYLOAD_COLOR;

  return (
    <div className="p-4 font-mono text-[12px] leading-5 select-none">
      {rows.map((off) => (
        <div key={off} className="flex gap-3">
          <span className="w-10 shrink-0 text-right text-zinc-600">
            {off.toString(16).padStart(4, '0')}
          </span>
          <span className="flex">
            {Array.from({ length: 16 }, (_, i) => {
              const b = off + i;
              if (b >= packet.bytes.length)
                return (
                  <span key={i} className="px-[3px]">
                    {'  '}
                  </span>
                );
              const active = byteActive(b);
              const c = colorOfByte(b);
              return (
                <span
                  key={i}
                  className={`cursor-pointer rounded-sm px-[3px] ${i === 8 ? 'ml-2' : ''}`}
                  style={{
                    background: active ? c.fillHover : c.tint,
                    color: active ? 'var(--hex-active-ink)' : undefined,
                  }}
                  onMouseEnter={() => setHovered(refOfByte(b))}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => {
                    const ref = refOfByte(b);
                    if (ref) toggleLocked(ref);
                  }}
                >
                  {packet.bytes[b]!.toString(16).padStart(2, '0')}
                </span>
              );
            })}
          </span>
          <span className="shrink-0 text-zinc-500">
            {Array.from({ length: Math.min(16, packet.bytes.length - off) }, (_, i) => {
              const b = off + i;
              const ch = packet.bytes[b]!;
              const active = byteActive(b);
              return (
                <span
                  key={i}
                  style={
                    active
                      ? { background: colorOfByte(b).fillHover, color: 'var(--hex-active-ink)' }
                      : undefined
                  }
                >
                  {ch >= 0x20 && ch < 0x7f ? String.fromCharCode(ch) : '·'}
                </span>
              );
            })}
          </span>
        </div>
      ))}
    </div>
  );
}
