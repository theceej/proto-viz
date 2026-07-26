import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Pencil } from 'lucide-react';
import type { FieldSpan, SerializedPacket } from '../../core/serialize';
import type { Registry } from '../../core/registry';
import type { ValidationIssue } from '../../core/validate';
import { isActive, useHighlightStore, type FieldRef } from '../../store/highlightStore';
import { layerColor, PAYLOAD_COLOR, type LayerColor } from '../colors';
import { usePersistedFlag } from '../usePersistedFlag';
import { useMediaQuery } from '../useMediaQuery';
import FieldInspector, { asciiByte } from './FieldInspector';
import InspectionModeSelector from './InspectionModeSelector';
import type { InspectionMode } from '../inspectionMode';
import { PaneScrollContext } from './ResizablePanes';

const PAYLOAD_REF: FieldRef = { layerUid: '__payload__', fieldId: 'payload' };
const ROW_HEIGHT = 20;
const OVERSCAN_ROWS = 6;
const DEFAULT_VIEWPORT_HEIGHT = 400;

export interface VirtualRowRange {
  start: number;
  end: number;
}

/** Returns an overscanned, end-exclusive row range bounded by the packet. */
export function virtualRowRange(
  totalRows: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight = ROW_HEIGHT,
  overscan = OVERSCAN_ROWS,
): VirtualRowRange {
  if (totalRows <= 0) return { start: 0, end: 0 };
  const start = Math.min(totalRows - 1, Math.max(0, Math.floor(scrollTop / rowHeight) - overscan));
  const visibleEnd = Math.ceil((scrollTop + Math.max(1, viewportHeight)) / rowHeight);
  return { start, end: Math.max(start + 1, Math.min(totalRows, visibleEnd + overscan)) };
}

function offsetTopWithin(element: HTMLElement | null, ancestor: HTMLElement): number {
  if (!element) return 0;
  const elementRect = element.getBoundingClientRect();
  const ancestorRect = ancestor.getBoundingClientRect();
  if (elementRect.top !== 0 || ancestorRect.top !== 0) {
    return elementRect.top - ancestorRect.top + ancestor.scrollTop;
  }
  let top = 0;
  let current: HTMLElement | null = element;
  while (current && current !== ancestor) {
    top += current.offsetTop;
    current = current.offsetParent as HTMLElement | null;
  }
  return top;
}

/** Full-packet hex dump with layer tints and field hover-linking. */
export default function HexView({
  packet,
  registry,
  validation = [],
  inspectionMode = 'explain',
  onInspectionModeChange = () => undefined,
  onByteEdit,
  mutatedBits,
}: {
  packet: SerializedPacket;
  registry: Registry;
  validation?: ValidationIssue[];
  inspectionMode?: InspectionMode;
  onInspectionModeChange?: (mode: InspectionMode) => void;
  /** When provided, hex bytes become keyboard-editable (builder only). */
  onByteEdit?: (byteOffset: number, value: number) => void;
  /**
   * Bit ranges a fuzzing run changed. Marked with a dashed outline *and*
   * named in each byte's label, so the mark is never colour alone.
   */
  mutatedBits?: { bitOffset: number; bitLength: number }[];
}) {
  const { setHovered, toggleLocked } = useHighlightStore();
  const hovered = useHighlightStore((s) => s.hovered);
  const locked = useHighlightStore((s) => s.locked);
  const [focusedByte, setFocusedByte] = useState(0);
  const [activeFocus, setActiveFocus] = useState<number | null>(null);
  // In-progress hex entry for the byte being typed over: 1 nibble pending, or
  // null when not editing. Two nibbles commit and clear immediately.
  const [editing, setEditing] = useState<{ byte: number; nibble: string } | null>(null);
  const [hexVisible, setHexVisible] = usePersistedFlag('pv-hex-column', true);
  const [asciiVisible, setAsciiVisible] = usePersistedFlag('pv-hex-ascii', true);
  const [editMode, setEditMode] = usePersistedFlag('pv-hex-edit', false);
  // Editing is opt-in: only when the host wired an editor (builder) and the
  // user turned on Edit mode. Otherwise the hex view is inspect-only.
  const editable = Boolean(onByteEdit) && editMode;
  const byteRefs = useRef(new Map<number, HTMLSpanElement>());
  const asciiRefs = useRef(new Map<number, HTMLSpanElement>());
  const paneScrollElement = useContext(PaneScrollContext);
  const [selfScrollElement, setSelfScrollElement] = useState<HTMLDivElement | null>(null);
  const scrollElement = paneScrollElement ?? selfScrollElement;
  const rowsElement = useRef<HTMLDivElement>(null);
  const toolbarElement = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<{ byte: number; column: 'hex' | 'ascii' } | null>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: DEFAULT_VIEWPORT_HEIGHT });
  const tabStopByte = Math.min(focusedByte, Math.max(0, packet.bytes.length - 1));
  // Below the mobile breakpoint the 16-byte row doesn't fit; halve it to 8.
  const bytesPerRow = useMediaQuery('(max-width: 767px)') ? 8 : 16;

  const totalRows = Math.ceil(packet.bytes.length / bytesPerRow);
  const range = virtualRowRange(totalRows, viewport.scrollTop, viewport.height);
  const retainedRow =
    activeFocus !== null || editing !== null
      ? Math.floor((activeFocus ?? editing?.byte ?? 0) / bytesPerRow)
      : null;
  const renderedRows = useMemo(() => {
    const result = Array.from({ length: range.end - range.start }, (_, i) => range.start + i);
    if (retainedRow !== null && (retainedRow < range.start || retainedRow >= range.end)) {
      result.push(retainedRow);
      result.sort((a, b) => a - b);
    }
    return result;
  }, [range.start, range.end, retainedRow]);

  const protocolByLayerUid = useMemo(
    () => new Map(packet.layers.map((layer) => [layer.uid, layer.protocolId])),
    [packet.layers],
  );

  const { spansByByte, layerByByte } = useMemo(() => {
    const spans = new Map<number, FieldSpan[]>();
    for (const span of packet.spans) {
      if (span.bitLength === 0) continue;
      const first = Math.max(0, Math.floor(span.bitOffset / 8));
      const last = Math.min(
        packet.bytes.length - 1,
        Math.floor((span.bitOffset + span.bitLength - 1) / 8),
      );
      for (const row of renderedRows) {
        const rowFirst = row * bytesPerRow;
        const rowLast = Math.min(packet.bytes.length - 1, rowFirst + bytesPerRow - 1);
        for (let b = Math.max(first, rowFirst); b <= Math.min(last, rowLast); b++) {
          const owners = spans.get(b);
          if (owners) owners.push(span);
          else spans.set(b, [span]);
        }
      }
    }
    const layers = new Map<number, number>();
    for (const row of renderedRows) {
      const end = Math.min(packet.bytes.length, (row + 1) * bytesPerRow);
      for (let b = row * bytesPerRow; b < end; b++) {
        const layer = packet.layers.findIndex(
          (candidate) =>
            b >= candidate.byteOffset && b < candidate.byteOffset + candidate.headerBytes,
        );
        if (layer >= 0) layers.set(b, layer);
      }
    }
    return { spansByByte: spans, layerByByte: layers };
  }, [bytesPerRow, packet, renderedRows]);

  useEffect(() => {
    if (!scrollElement) return;
    const updateViewport = () => {
      const contentTop = offsetTopWithin(rowsElement.current, scrollElement);
      setViewport({
        scrollTop: Math.max(0, scrollElement.scrollTop - contentTop),
        height: scrollElement.clientHeight || DEFAULT_VIEWPORT_HEIGHT,
      });
    };
    updateViewport();
    scrollElement.addEventListener('scroll', updateViewport, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateViewport);
    observer?.observe(scrollElement);
    if (toolbarElement.current) observer?.observe(toolbarElement.current);
    window.addEventListener('resize', updateViewport);
    return () => {
      scrollElement.removeEventListener('scroll', updateViewport);
      observer?.disconnect();
      window.removeEventListener('resize', updateViewport);
    };
  }, [scrollElement, packet.bytes.length, bytesPerRow]);

  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    const element = (pending.column === 'hex' ? byteRefs : asciiRefs).current.get(pending.byte);
    if (element) {
      pendingFocus.current = null;
      element.focus();
    }
  }, [renderedRows]);

  if (packet.bytes.length === 0) {
    return <div className="p-4 text-xs text-zinc-600 italic">empty packet</div>;
  }

  const byteActive = (b: number): boolean =>
    (spansByByte.get(b)?.length ?? 0) === 0
      ? isActive(hovered, PAYLOAD_REF.layerUid, PAYLOAD_REF.fieldId) ||
        isActive(locked, PAYLOAD_REF.layerUid, PAYLOAD_REF.fieldId)
      : spansByByte.get(b)!.some(
          (s) =>
            isActive(hovered, s.layerUid, s.fieldId) ||
            isActive(locked, s.layerUid, s.fieldId),
        );

  const refOfByte = (b: number): FieldRef => {
    const s = spansByByte.get(b)?.[0];
    return s ? { layerUid: s.layerUid, fieldId: s.fieldId } : PAYLOAD_REF;
  };

  const labelOfByte = (b: number): string => {
    const value = packet.bytes[b]!.toString(16).padStart(2, '0');
    const owners = (spansByByte.get(b) ?? [])
      .map((span) => {
        const protocol = protocolByLayerUid.get(span.layerUid);
        return `${protocol ?? 'payload'} ${span.fieldId}`;
      })
      .join(', ');
    return `Byte offset ${b} (0x${b.toString(16)}), value 0x${value}, ${owners || 'payload'}`;
  };

  const moveFocus = (
    from: number,
    key: string,
    column: 'hex' | 'ascii',
  ): boolean => {
    let next: number;
    if (key === 'ArrowLeft') next = Math.max(0, from - 1);
    else if (key === 'ArrowRight') next = Math.min(packet.bytes.length - 1, from + 1);
    else if (key === 'ArrowUp') next = Math.max(0, from - bytesPerRow);
    else if (key === 'ArrowDown') next = Math.min(packet.bytes.length - 1, from + bytesPerRow);
    else return false;
    if (next === from) return true;
    setFocusedByte(next);
    pendingFocus.current = { byte: next, column };
    const mounted = (column === 'hex' ? byteRefs : asciiRefs).current.get(next);
    if (mounted) {
      pendingFocus.current = null;
      mounted.focus();
      return true;
    }
    const destinationRow = Math.floor(next / bytesPerRow);
    if (scrollElement && (destinationRow < range.start || destinationRow >= range.end)) {
      const contentTop = offsetTopWithin(rowsElement.current, scrollElement);
      const toolbarHeight = toolbarElement.current?.getBoundingClientRect().height ?? 0;
      const destinationTop = contentTop + destinationRow * ROW_HEIGHT;
      const destinationBottom = destinationTop + ROW_HEIGHT;
      let nextScrollTop = scrollElement.scrollTop;
      if (destinationTop < scrollElement.scrollTop + toolbarHeight)
        nextScrollTop = destinationTop - toolbarHeight;
      else if (destinationBottom > scrollElement.scrollTop + scrollElement.clientHeight)
        nextScrollTop = destinationBottom - scrollElement.clientHeight;
      scrollElement.scrollTo({ top: Math.max(0, nextScrollTop) });
      setViewport({
        scrollTop: Math.max(0, nextScrollTop - contentTop),
        height: scrollElement.clientHeight || DEFAULT_VIEWPORT_HEIGHT,
      });
    }
    return true;
  };

  const colorOfByte = (b: number): LayerColor =>
    layerByByte.has(b) ? layerColor(layerByByte.get(b)!) : PAYLOAD_COLOR;

  const isMutated = (b: number): boolean =>
    (mutatedBits ?? []).some((mutation) => {
      const first = Math.floor(mutation.bitOffset / 8);
      const last = Math.floor(
        (mutation.bitOffset + Math.max(1, mutation.bitLength) - 1) / 8,
      );
      return b >= first && b <= last;
    });

  const commitByte = (b: number, value: number) => {
    setEditing(null);
    onByteEdit?.(b, value);
    // The byte cell keeps its DOM node across the re-serialize, so refocus it
    // after the store round-trips to keep keyboard editing continuous.
    requestAnimationFrame(() => byteRefs.current.get(b)?.focus());
  };

  /** Handle a keystroke on an editable hex byte. Returns true if consumed. */
  const handleEditKey = (b: number, key: string): boolean => {
    if (!editable) return false;
    if (/^[0-9a-fA-F]$/.test(key)) {
      const pending = editing?.byte === b ? editing.nibble : '';
      if (pending === '') setEditing({ byte: b, nibble: key.toLowerCase() });
      else commitByte(b, parseInt(pending + key, 16));
      return true;
    }
    if (editing?.byte === b) {
      if (key === 'Escape') {
        setEditing(null);
        return true;
      }
      if (key === 'Enter' || key === ' ') {
        commitByte(b, parseInt(editing.nibble, 16));
        return true;
      }
    }
    // Reject length-changing edits outright.
    if (key === 'Backspace' || key === 'Delete') {
      if (editing?.byte === b) setEditing(null);
      return true;
    }
    return false;
  };

  return (
    <div
      ref={setSelfScrollElement}
      className={paneScrollElement ? undefined : 'h-full min-h-0 overflow-auto'}
      role="group"
      aria-label={`Packet hex dump, ${packet.bytes.length} total bytes`}
    >
      <div ref={toolbarElement} className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur">
        <div className="flex flex-wrap items-center justify-end gap-y-1 border-b border-zinc-800/50 px-2 py-1">
          <InspectionModeSelector mode={inspectionMode} onChange={onInspectionModeChange} />
          <span className="mx-1 h-4 w-px bg-zinc-800" aria-hidden />
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-zinc-600">Columns</span>
            {([
              ['Hex', hexVisible, () => setHexVisible(!hexVisible)],
              ['ASCII', asciiVisible, () => setAsciiVisible(!asciiVisible)],
            ] as const).map(([label, visible, toggle]) => (
              <button
                key={label}
                className={`cursor-pointer rounded-md border px-1.5 py-0.5 text-[10px] ${
                  visible
                    ? 'border-zinc-700 bg-zinc-800 font-medium text-zinc-100'
                    : 'border-zinc-800 text-zinc-500 hover:text-zinc-200'
                }`}
                aria-pressed={visible}
                title={`Show or hide the ${label} column`}
                onClick={toggle}
              >
                {label}
              </button>
            ))}
          </div>
          {onByteEdit && (
            <>
              <span className="mx-1 h-4 w-px bg-zinc-800" aria-hidden />
              <button
                className={`flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] ${
                  editMode
                    ? 'border-cyan-700 bg-cyan-900/40 font-medium text-cyan-200'
                    : 'border-zinc-800 text-zinc-500 hover:text-zinc-200'
                }`}
                aria-pressed={editMode}
                title="Edit mode: type two hex digits over a byte to overwrite it"
                onClick={() => {
                  setEditMode(!editMode);
                  setEditing(null); // drop any half-typed nibble when switching modes
                }}
              >
                <Pencil className="size-3" aria-hidden />
                Edit
              </button>
            </>
          )}
          <CopyHexButton bytes={packet.bytes} />
        </div>
        {editable && (
          <p className="border-b border-zinc-800/50 bg-cyan-950/20 px-3 py-1 text-[10px] leading-snug text-cyan-300/90">
            Type two hex digits over a byte to overwrite it — fields, diagram, and
            validation update live. Hand-editing a computed field (checksum, length) pins it.
          </p>
        )}
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
      <p className="sr-only" aria-live="polite" data-visible-byte-range>
        Visible window bytes {range.start * bytesPerRow} through{' '}
        {Math.min(packet.bytes.length - 1, range.end * bytesPerRow - 1)} of{' '}
        {packet.bytes.length} total bytes.
      </p>
      <div
        ref={rowsElement}
        className="relative mx-4 mt-2 mb-4 font-mono text-[12px] leading-5 select-none"
        style={{ height: totalRows * ROW_HEIGHT }}
      >
        {renderedRows.map((row) => {
          const off = row * bytesPerRow;
          return (
            <div
              key={row}
              className="absolute right-0 left-0 flex h-5 gap-3"
              style={{ top: row * ROW_HEIGHT }}
            >
          <span className="w-10 shrink-0 text-right text-zinc-600">
            {off.toString(16).padStart(4, '0')}
          </span>
          {hexVisible && <span className="flex" role="group" aria-label={`Hex bytes ${off} through ${Math.min(off + bytesPerRow - 1, packet.bytes.length - 1)}`}>
            {Array.from({ length: bytesPerRow }, (_, i) => {
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
              const isEditing = editing?.byte === b;
              return (
                <span
                  key={i}
                  ref={(element) => {
                    if (element) byteRefs.current.set(b, element);
                    else byteRefs.current.delete(b);
                  }}
                  role="button"
                  tabIndex={b === tabStopByte ? 0 : -1}
                  data-byte-offset={b}
                  aria-label={
                    isEditing
                      ? `Editing byte offset ${b}: type a hex digit to set the value, Escape to cancel`
                      : `${labelOfByte(b)}${isMutated(b) ? '. Mutated' : ''}${
                          editable ? '. Type two hex digits to edit' : ''
                        }`
                  }
                  aria-pressed={isActive(locked, ref.layerUid, ref.fieldId)}
                  className={`${editable ? 'cursor-text' : 'cursor-pointer'} rounded-sm px-[3px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cyan-400 ${i === bytesPerRow / 2 ? 'ml-2' : ''} ${isEditing ? 'outline-2 outline-cyan-400' : ''} ${
                    isMutated(b) && !isEditing
                      ? 'outline-2 outline-dashed outline-offset-[-1px] outline-rose-400'
                      : ''
                  }`}
                  style={{
                    background: isEditing ? 'var(--hex-editing, #164e63)' : active ? c.fillHover : c.tint,
                    color: isEditing || active ? 'var(--hex-active-ink)' : undefined,
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
                    if (isEditing) setEditing(null);
                  }}
                  onKeyDown={(event) => {
                    if (moveFocus(b, event.key, 'hex')) {
                      event.preventDefault();
                      if (editing) setEditing(null);
                      return;
                    }
                    if (handleEditKey(b, event.key)) {
                      event.preventDefault();
                      return;
                    }
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      // Edit mode reserves Enter/Space for committing edits.
                      if (!editable) toggleLocked(ref);
                    }
                  }}
                  onClick={() => {
                    // In edit mode a click just places the cursor for typing.
                    if (!editable) toggleLocked(ref);
                  }}
                >
                  {isEditing
                    ? editing.nibble.padEnd(2, ' ')
                    : packet.bytes[b]!.toString(16).padStart(2, '0')}
                </span>
              );
            })}
          </span>}
          {asciiVisible && (
            <span
              className="flex shrink-0 text-zinc-500"
              role="group"
              aria-label={`ASCII bytes ${off} through ${Math.min(off + bytesPerRow - 1, packet.bytes.length - 1)}`}
            >
              {Array.from({ length: Math.min(bytesPerRow, packet.bytes.length - off) }, (_, i) => {
              const b = off + i;
              const active = byteActive(b);
              const ref = refOfByte(b);
              return (
                <span
                  key={i}
                  ref={(element) => {
                    if (element) asciiRefs.current.set(b, element);
                    else asciiRefs.current.delete(b);
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
                    if (moveFocus(b, event.key, 'ascii')) {
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
          );
        })}
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
