import { useMemo, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { SerializedPacket } from '../../core/serialize';
import type { Registry } from '../../core/registry';
import type { ValidationIssue } from '../../core/validate';
import { buildSpanIndex } from '../../core/spanIndex';
import { isActive, useHighlightStore, type FieldRef } from '../../store/highlightStore';
import { layerColor, PAYLOAD_COLOR, type LayerColor } from '../colors';
import { usePersistedFlag } from '../usePersistedFlag';
import FieldInspector, { asciiByte } from './FieldInspector';
import InspectionModeSelector from './InspectionModeSelector';
import type { InspectionMode } from '../inspectionMode';

const PAYLOAD_REF: FieldRef = { layerUid: '__payload__', fieldId: 'payload' };

/** Full-packet hex dump with layer tints and field hover-linking. */
export default function HexView({
  packet,
  registry,
  validation = [],
  inspectionMode = 'explain',
  onInspectionModeChange = () => undefined,
}: {
  packet: SerializedPacket;
  registry: Registry;
  validation?: ValidationIssue[];
  inspectionMode?: InspectionMode;
  onInspectionModeChange?: (mode: InspectionMode) => void;
}) {
  const { setHovered, toggleLocked } = useHighlightStore();
  const hovered = useHighlightStore((s) => s.hovered);
  const locked = useHighlightStore((s) => s.locked);
  const [focusedByte, setFocusedByte] = useState(0);
  const [activeFocus, setActiveFocus] = useState<number | null>(null);
  const [asciiVisible, setAsciiVisible] = usePersistedFlag('pv-hex-ascii', true);
  const byteRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const asciiRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const tabStopByte = Math.min(focusedByte, Math.max(0, packet.bytes.length - 1));

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
    spanIndex[b]!.length === 0
      ? isActive(hovered, PAYLOAD_REF.layerUid, PAYLOAD_REF.fieldId) ||
        isActive(locked, PAYLOAD_REF.layerUid, PAYLOAD_REF.fieldId)
      : spanIndex[b]!.some(
          (s) =>
            isActive(hovered, s.layerUid, s.fieldId) ||
            isActive(locked, s.layerUid, s.fieldId),
        );

  const refOfByte = (b: number): FieldRef => {
    const s = spanIndex[b]![0];
    return s ? { layerUid: s.layerUid, fieldId: s.fieldId } : PAYLOAD_REF;
  };

  const labelOfByte = (b: number): string => {
    const value = packet.bytes[b]!.toString(16).padStart(2, '0');
    const owners = spanIndex[b]!
      .map((span) => {
        const protocol = packet.layers.find((layer) => layer.uid === span.layerUid)?.protocolId;
        return `${protocol ?? 'payload'} ${span.fieldId}`;
      })
      .join(', ');
    return `Byte offset ${b} (0x${b.toString(16)}), value 0x${value}, ${owners || 'payload'}`;
  };

  const moveFocus = (
    from: number,
    key: string,
    refs: { current: (HTMLSpanElement | null)[] },
  ): boolean => {
    let next: number;
    if (key === 'ArrowLeft') next = Math.max(0, from - 1);
    else if (key === 'ArrowRight') next = Math.min(packet.bytes.length - 1, from + 1);
    else if (key === 'ArrowUp') next = Math.max(0, from - 16);
    else if (key === 'ArrowDown') next = Math.min(packet.bytes.length - 1, from + 16);
    else return false;
    setFocusedByte(next);
    refs.current[next]?.focus();
    return true;
  };

  const colorOfByte = (b: number): LayerColor =>
    layerOfByte[b]! >= 0 ? layerColor(layerOfByte[b]!) : PAYLOAD_COLOR;

  return (
    <div>
      <div className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur">
        <div className="flex flex-wrap items-center justify-end gap-y-1 border-b border-zinc-800/50 px-2 py-1">
          <InspectionModeSelector mode={inspectionMode} onChange={onInspectionModeChange} />
          <button
            className={`mr-1 cursor-pointer rounded px-1.5 font-mono text-[10px] ${
              asciiVisible ? 'bg-zinc-800 text-zinc-300' : 'text-zinc-600 hover:text-zinc-300'
            }`}
            aria-pressed={asciiVisible}
            onClick={() => setAsciiVisible(!asciiVisible)}
          >
            ASCII
          </button>
          <CopyHexButton bytes={packet.bytes} />
        </div>
        {locked && (
          <FieldInspector
            packet={packet}
            registry={registry}
            selected={locked}
            validation={validation}
            mode={inspectionMode}
          />
        )}
      </div>
      <div className="px-4 pt-2 pb-4 font-mono text-[12px] leading-5 select-none">
        {rows.map((off) => (
        <div key={off} className="flex gap-3">
          <span className="w-10 shrink-0 text-right text-zinc-600">
            {off.toString(16).padStart(4, '0')}
          </span>
          <span className="flex" role="group" aria-label={`Bytes ${off} through ${Math.min(off + 15, packet.bytes.length - 1)}`}>
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
              const ref = refOfByte(b);
              return (
                <span
                  key={i}
                  ref={(element) => {
                    byteRefs.current[b] = element;
                  }}
                  role="button"
                  tabIndex={b === tabStopByte ? 0 : -1}
                  data-byte-offset={b}
                  aria-label={labelOfByte(b)}
                  aria-pressed={isActive(locked, ref.layerUid, ref.fieldId)}
                  className={`cursor-pointer rounded-sm px-[3px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cyan-400 ${i === 8 ? 'ml-2' : ''}`}
                  style={{
                    background: active ? c.fillHover : c.tint,
                    color: active ? 'var(--hex-active-ink)' : undefined,
                  }}
                  onMouseEnter={() => setHovered(refOfByte(b))}
                  onMouseLeave={() => setHovered(activeFocus === null ? null : refOfByte(activeFocus))}
                  onFocus={() => {
                    setFocusedByte(b);
                    setActiveFocus(b);
                    setHovered(refOfByte(b));
                  }}
                  onBlur={() => {
                    setActiveFocus(null);
                    setHovered(null);
                  }}
                  onKeyDown={(event) => {
                    if (moveFocus(b, event.key, byteRefs)) {
                      event.preventDefault();
                      return;
                    }
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      toggleLocked(ref);
                    }
                  }}
                  onClick={() => toggleLocked(ref)}
                >
                  {packet.bytes[b]!.toString(16).padStart(2, '0')}
                </span>
              );
            })}
          </span>
          {asciiVisible && (
            <span
              className="flex shrink-0 text-zinc-500"
              role="group"
              aria-label={`ASCII bytes ${off} through ${Math.min(off + 15, packet.bytes.length - 1)}`}
            >
              {Array.from({ length: Math.min(16, packet.bytes.length - off) }, (_, i) => {
              const b = off + i;
              const active = byteActive(b);
              const ref = refOfByte(b);
              return (
                <span
                  key={i}
                  ref={(element) => {
                    asciiRefs.current[b] = element;
                  }}
                  role="button"
                  tabIndex={b === tabStopByte ? 0 : -1}
                  data-ascii-offset={b}
                  aria-label={`${labelOfByte(b)}, ASCII ${asciiByte(packet.bytes[b]!)}`}
                  aria-pressed={isActive(locked, ref.layerUid, ref.fieldId)}
                  className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cyan-400"
                  style={
                    active
                      ? { background: colorOfByte(b).fillHover, color: 'var(--hex-active-ink)' }
                      : undefined
                  }
                  onMouseEnter={() => setHovered(ref)}
                  onMouseLeave={() => setHovered(activeFocus === null ? null : refOfByte(activeFocus))}
                  onFocus={() => {
                    setFocusedByte(b);
                    setActiveFocus(b);
                    setHovered(ref);
                  }}
                  onBlur={() => {
                    setActiveFocus(null);
                    setHovered(null);
                  }}
                  onKeyDown={(event) => {
                    if (moveFocus(b, event.key, asciiRefs)) {
                      event.preventDefault();
                      return;
                    }
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      toggleLocked(ref);
                    }
                  }}
                  onClick={() => toggleLocked(ref)}
                >
                  {asciiByte(packet.bytes[b]!)}
                </span>
              );
              })}
            </span>
          )}
        </div>
        ))}
      </div>
    </div>
  );
}

/** Copies the whole packet as a continuous lowercase hex string. */
function CopyHexButton({ bytes }: { bytes: Uint8Array }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    void navigator.clipboard.writeText(hex).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <button
      className={`grid size-6 cursor-pointer place-items-center rounded transition-colors ${
        copied ? 'text-emerald-400' : 'text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200'
      }`}
      title="Copy the packet as a hex string"
      aria-label={copied ? 'Packet hex copied' : 'Copy the packet as a hex string'}
      onClick={copy}
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </button>
  );
}
