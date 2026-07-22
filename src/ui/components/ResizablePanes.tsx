import { useRef, useState } from 'react';
import { ChevronsLeftRight, ChevronsRightLeft } from 'lucide-react';
import { usePersistedFlag } from '../usePersistedFlag';

/**
 * The builder/scenario inspection row: three panes — field editor, packet
 * diagrams, hex dump — each collapsible to a slim strip, with draggable and
 * keyboard-operable dividers between them. Collapse state and split widths
 * persist per `storagePrefix`, so different pages keep independent layouts.
 *
 * The centre (diagrams) pane always flexes; the outer two take a persisted
 * width. Collapsing the centre lets an outer pane flex to fill the space, and
 * the dividers relabel themselves to match whichever panes they sit between.
 */
export interface PaneContent {
  title: string;
  scrollFocusable?: boolean;
  children: React.ReactNode;
}

const OUTER_PANE_CLASS = 'w-[clamp(22rem,30vw,42rem)] shrink-0';

export default function ResizablePanes({
  storagePrefix,
  left,
  center,
  right,
}: {
  storagePrefix: string;
  left: PaneContent;
  center: PaneContent;
  right: PaneContent;
}) {
  const [leftCollapsed, setLeftCollapsed] = usePersistedFlag(`${storagePrefix}-fields`, false);
  const [centerCollapsed, setCenterCollapsed] = usePersistedFlag(
    `${storagePrefix}-diagrams`,
    false,
  );
  const [rightCollapsed, setRightCollapsed] = usePersistedFlag(`${storagePrefix}-hex`, false);
  const [leftWidth, setLeftWidth] = usePersistedPaneWidth(`${storagePrefix}-fields-width`);
  const [rightWidth, setRightWidth] = usePersistedPaneWidth(`${storagePrefix}-hex-width`);

  const rightFlexes = centerCollapsed && leftCollapsed;

  return (
    <div className="flex min-h-0 flex-1 border-t border-zinc-800">
      <Pane
        title={left.title}
        collapsed={leftCollapsed}
        onToggle={setLeftCollapsed}
        expandedClass={centerCollapsed ? 'min-w-0 flex-1' : OUTER_PANE_CLASS}
        width={centerCollapsed ? null : leftWidth}
        className="border-r border-zinc-800"
      >
        {left.children}
      </Pane>
      {!leftCollapsed && !centerCollapsed && (
        <PaneResizeHandle
          label={`Resize ${left.title.toLowerCase()} and ${center.title.toLowerCase()}`}
          value={leftWidth}
          onChange={setLeftWidth}
        />
      )}
      <Pane
        title={center.title}
        collapsed={centerCollapsed}
        onToggle={setCenterCollapsed}
        expandedClass="min-w-0 flex-1"
      >
        {center.children}
      </Pane>
      {!rightCollapsed && (!centerCollapsed || !leftCollapsed) && (
        <PaneResizeHandle
          label={`Resize ${(centerCollapsed ? left.title : center.title).toLowerCase()} and ${right.title.toLowerCase()}`}
          reverse
          value={rightWidth}
          onChange={setRightWidth}
        />
      )}
      <Pane
        title={right.title}
        collapsed={rightCollapsed}
        onToggle={setRightCollapsed}
        expandedClass={rightFlexes ? 'min-w-0 flex-1' : OUTER_PANE_CLASS}
        width={rightFlexes ? null : rightWidth}
        className="border-l border-zinc-800"
        scrollFocusable={right.scrollFocusable}
      >
        {right.children}
      </Pane>
    </div>
  );
}

/**
 * A single pane that collapses to a slim vertical strip. Collapse state is
 * owned by the parent; when expanded it takes `expandedClass` (and an optional
 * pixel `width` from a drag).
 */
function Pane({
  title,
  collapsed,
  onToggle,
  expandedClass,
  width = null,
  className = '',
  scrollFocusable = false,
  children,
}: {
  title: string;
  collapsed: boolean;
  onToggle: (collapsed: boolean) => void;
  expandedClass: string;
  width?: number | null;
  className?: string;
  scrollFocusable?: boolean;
  children: React.ReactNode;
}) {
  if (collapsed) {
    return (
      <div className={`flex w-9 shrink-0 ${className}`}>
        <button
          className="flex w-full cursor-pointer flex-col items-center gap-2 py-2 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
          aria-label={`Expand ${title.toLowerCase()} pane`}
          aria-expanded={false}
          onClick={() => onToggle(false)}
        >
          <ChevronsLeftRight className="size-4 shrink-0" aria-hidden />
          <span className="text-[11px] tracking-wide select-none [writing-mode:vertical-rl]">
            {title}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div
      className={`flex min-h-0 flex-col ${expandedClass} ${className}`}
      style={width === null ? undefined : { width }}
      role="region"
      aria-label={title}
    >
      <div className="flex shrink-0 items-center border-b border-zinc-800/70 py-0.5 pr-1 pl-3">
        <span className="text-[10px] font-semibold tracking-widest text-zinc-600 uppercase select-none">
          {title}
        </span>
        <button
          className="ml-auto cursor-pointer rounded p-1.5 text-zinc-600 hover:bg-zinc-800/60 hover:text-zinc-200"
          aria-label={`Collapse ${title.toLowerCase()} pane`}
          aria-expanded
          onClick={() => onToggle(true)}
        >
          <ChevronsRightLeft className="size-3.5" aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto" tabIndex={scrollFocusable ? 0 : undefined}>
        {children}
      </div>
    </div>
  );
}

const MIN_PANE_WIDTH = 288;
const MAX_PANE_WIDTH = 960;

/** Persisted pixel width for a pane; `null` means "use the responsive default". */
export function usePersistedPaneWidth(
  key: string,
): [number | null, (width: number | null) => void] {
  const [width, setWidth] = useState<number | null>(
    () => Math.max(0, Number(localStorage.getItem(key))) || null,
  );
  return [
    width,
    (next) => {
      setWidth(next);
      if (next === null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(next));
    },
  ];
}

function PaneResizeHandle({
  label,
  reverse = false,
  value,
  onChange,
}: {
  label: string;
  reverse?: boolean;
  value: number | null;
  onChange: (width: number | null) => void;
}) {
  const drag = useRef<[number, number] | null>(null);
  const adjacentWidth = (handle: HTMLElement) => {
    const pane = reverse ? handle.nextElementSibling : handle.previousElementSibling;
    return pane?.getBoundingClientRect().width ?? MIN_PANE_WIDTH;
  };
  const clampWidth = (width: number) =>
    Math.max(MIN_PANE_WIDTH, Math.min(MAX_PANE_WIDTH, width));

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={MIN_PANE_WIDTH}
      aria-valuemax={MAX_PANE_WIDTH}
      aria-valuenow={value ?? 480}
      aria-valuetext={value === null ? 'Responsive default' : `${value} pixels`}
      tabIndex={0}
      className="group relative z-10 w-2 shrink-0 cursor-col-resize touch-none bg-zinc-950 focus-visible:outline-2 focus-visible:outline-cyan-400"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = [event.clientX, adjacentWidth(event.currentTarget)];
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const movement = event.clientX - drag.current[0];
        onChange(clampWidth(drag.current[1] + (reverse ? -movement : movement)));
      }}
      onPointerUp={() => (drag.current = null)}
      onKeyDown={(event) => {
        if (event.key === 'Home') {
          event.preventDefault();
          onChange(null);
          return;
        }
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const movement = event.key === 'ArrowLeft' ? -24 : 24;
        const width = value ?? adjacentWidth(event.currentTarget);
        onChange(clampWidth(width + (reverse ? -movement : movement)));
      }}
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-zinc-800 group-hover:bg-cyan-700 group-focus:bg-cyan-500" />
    </div>
  );
}
