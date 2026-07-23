import { Fragment, useMemo } from 'react';
import type { ProtocolDefinition } from '../../core/model';
import type { FieldSpan, LayerLayout } from '../../core/serialize';
import { isActive, useHighlightStore } from '../../store/highlightStore';
import type { LayerColor } from '../colors';
import { bitsLabel, formatFieldValueShort } from '../format';

interface Segment {
  span: FieldSpan;
  row: number; // display row
  col: number; // 0..31
  width: number; // 1..32
  first: boolean; // first segment of its field (gets the label)
  collapsed?: string; // "⋯ N bytes" marker rows
}

/**
 * Classic RFC-style packet diagram: 32 bits per row, fields as labeled spans.
 * Long byte fields (payloads, options) are collapsed to first row + ellipsis.
 */
export default function BitGrid({
  def,
  layout,
  spans,
  color,
}: {
  def: ProtocolDefinition;
  layout: LayerLayout;
  spans: FieldSpan[];
  color: LayerColor;
}) {
  const { setHovered, toggleLocked } = useHighlightStore();
  const hovered = useHighlightStore((s) => s.hovered);
  const locked = useHighlightStore((s) => s.locked);

  const { segments, rowCount } = useMemo(
    () => computeSegments(spans, layout),
    [spans, layout],
  );

  const fieldById = useMemo(() => new Map(def.fields.map((f) => [f.id, f])), [def]);

  return (
    // On desktop keep the 32-bit grid at a legible minimum width, scrolling a
    // narrow (resized) pane horizontally rather than squashing the columns. On
    // phones the grid instead shrinks to fit the pane — a horizontal scroll
    // there is more annoying than tight columns. The ruler sticks while
    // scrolling down.
    <div className="md:min-w-[32rem]">
      {/* Bit ruler */}
      <div className="sticky top-0 z-10 grid grid-cols-32 bg-zinc-950 px-px font-mono text-[9px] text-zinc-600 select-none">
        {Array.from({ length: 32 }, (_, i) => (
          <div key={i} className="border-l border-zinc-800/60 pl-0.5 pb-0.5">
            {i % 4 === 0 ? i : ' '}
          </div>
        ))}
      </div>
      <div
        className="grid grid-cols-32 gap-px rounded-md"
        style={{ gridAutoRows: 'minmax(2.1rem, auto)' }}
      >
        {segments.map((seg, i) => {
          const field = fieldById.get(seg.span.fieldId);
          const active =
            isActive(hovered, seg.span.layerUid, seg.span.fieldId) ||
            isActive(locked, seg.span.layerUid, seg.span.fieldId);
          const label = field?.name ?? seg.span.fieldId;
          const value = field ? formatFieldValueShort(field, seg.span.value) : '';
          const ref = { layerUid: seg.span.layerUid, fieldId: seg.span.fieldId };
          // One keyboard stop per field: the labeled segment acts as a
          // toggle button that locks the cross-view highlight.
          const interactive = seg.first && !seg.collapsed;
          return (
            <div
              key={i}
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-pressed={interactive ? isActive(locked, ref.layerUid, ref.fieldId) : undefined}
              aria-label={
                interactive
                  ? `${def.name} ${label}, ${bitsLabel(seg.span.bitLength)}${value ? `, value ${value}` : ''}`
                  : undefined
              }
              className="flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-sm px-1 text-center leading-tight transition-colors duration-75 focus-visible:outline-2 focus-visible:outline-cyan-400"
              style={{
                gridColumn: `${seg.col + 1} / span ${seg.width}`,
                gridRow: seg.row + 1,
                background: active ? color.fillHover : color.fill,
                boxShadow: `inset 0 0 0 1px ${active ? color.accent : color.border}`,
              }}
              title={`${def.name} · ${label} — ${bitsLabel(seg.span.bitLength)}`}
              onMouseEnter={() => setHovered(ref)}
              onMouseLeave={() => setHovered(null)}
              onFocus={interactive ? () => setHovered(ref) : undefined}
              onBlur={interactive ? () => setHovered(null) : undefined}
              onClick={() => toggleLocked(ref)}
              onKeyDown={
                interactive
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleLocked(ref);
                      }
                    }
                  : undefined
              }
            >
              {seg.collapsed ? (
                <span className="text-[10px] text-zinc-400 italic">{seg.collapsed}</span>
              ) : seg.first ? (
                <Fragment>
                  {seg.width >= 3 && (
                    <span className="max-w-full truncate text-[11px] font-medium text-zinc-100">
                      {label}
                    </span>
                  )}
                  {seg.width >= 6 && value !== '' && (
                    <span className="max-w-full truncate font-mono text-[10px] text-zinc-300/90">
                      {value}
                    </span>
                  )}
                </Fragment>
              ) : (
                <span className="text-[10px] text-zinc-500">{seg.width >= 4 ? '⋯' : ''}</span>
              )}
            </div>
          );
        })}
        {rowCount === 0 && (
          <div className="col-span-32 py-2 text-center text-xs text-zinc-600 italic">
            no fields present
          </div>
        )}
      </div>
    </div>
  );
}

function computeSegments(
  spans: FieldSpan[],
  layout: LayerLayout,
): { segments: Segment[]; rowCount: number } {
  const base = layout.byteOffset * 8;

  // Absolute-row segments first.
  interface RawSeg {
    span: FieldSpan;
    row: number;
    col: number;
    width: number;
    first: boolean;
  }
  const raw: RawSeg[] = [];
  for (const span of spans) {
    let rel = span.bitOffset - base;
    let remaining = span.bitLength;
    const mine: RawSeg[] = [];
    while (remaining > 0) {
      const row = Math.floor(rel / 32);
      const col = rel % 32;
      const width = Math.min(32 - col, remaining);
      mine.push({ span, row, col, width, first: false });
      rel += width;
      remaining -= width;
    }
    // Label the widest segment (a MAC's 32-bit middle row reads better than
    // its 16-bit tail), preferring the earliest among ties.
    const widest = mine.reduce((a, b) => (b.width > a.width ? b : a), mine[0]!);
    if (widest) widest.first = true;
    raw.push(...mine);
  }

  // Collapse long single-field row runs (≥3 full rows from one field).
  const rowOwners = new Map<number, RawSeg[]>();
  for (const seg of raw) {
    const list = rowOwners.get(seg.row) ?? [];
    list.push(seg);
    rowOwners.set(seg.row, list);
  }
  const maxRow = raw.reduce((m, s) => Math.max(m, s.row), -1);

  const segments: Segment[] = [];
  const rowMap = new Map<number, number>(); // absolute -> display row
  let display = 0;
  let r = 0;
  while (r <= maxRow) {
    const owners = rowOwners.get(r) ?? [];
    const solo =
      owners.length === 1 && owners[0]!.width === 32 && !owners[0]!.first
        ? owners[0]!
        : null;
    if (solo) {
      // Count the run of full rows owned solely by this field.
      let runEnd = r;
      while (runEnd + 1 <= maxRow) {
        const next = rowOwners.get(runEnd + 1) ?? [];
        if (next.length === 1 && next[0]!.width === 32 && next[0]!.span === solo.span && !next[0]!.first)
          runEnd++;
        else break;
      }
      if (runEnd - r >= 2) {
        // Replace the run with one ellipsis row.
        const skippedBits = (runEnd - r + 1) * 32;
        segments.push({
          span: solo.span,
          row: display,
          col: 0,
          width: 32,
          first: false,
          collapsed: `⋯ ${skippedBits / 8} bytes`,
        });
        display++;
        r = runEnd + 1;
        continue;
      }
    }
    rowMap.set(r, display);
    display++;
    r++;
  }

  for (const seg of raw) {
    const dr = rowMap.get(seg.row);
    if (dr === undefined) continue; // collapsed away
    segments.push({ ...seg, row: dr });
  }

  return { segments, rowCount: display };
}
