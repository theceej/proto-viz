import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Pause, Play, Radio, SkipBack, SkipForward } from 'lucide-react';
import { useStackStore } from '../../store/stackStore';
import { useLibraryStore } from '../../store/libraryStore';
import { applicableScenarios, type Scenario } from '../../core/scenarios';
import {
  deriveTimeline,
  initialPlayback,
  reducePlayback,
  type Playback,
  type PlaybackAction,
  type TimelineStep,
} from '../../core/timeline';
import type { StackInstance } from '../../core/model';
import { usePrefersReducedMotion } from '../usePrefersReducedMotion';
import { useInspectionMode } from '../inspectionMode';
import ValidationPanel from '../components/ValidationPanel';
import HexView from '../components/HexView';
import FieldEditor from '../components/FieldEditor';
import PacketDiagrams from '../components/PacketDiagrams';
import ResizablePanes from '../components/ResizablePanes';

const ENDPOINT_LETTERS = ['A', 'B', 'C', 'D'];
const ENDPOINT_TINT = [
  { text: 'text-cyan-300', bg: 'bg-cyan-500/15', ring: 'ring-cyan-500/40' },
  { text: 'text-violet-300', bg: 'bg-violet-500/15', ring: 'ring-violet-500/40' },
  { text: 'text-amber-300', bg: 'bg-amber-500/15', ring: 'ring-amber-500/40' },
  { text: 'text-emerald-300', bg: 'bg-emerald-500/15', ring: 'ring-emerald-500/40' },
];
const tint = (i: number) => ENDPOINT_TINT[i] ?? ENDPOINT_TINT[0]!;
const letter = (i: number) => ENDPOINT_LETTERS[i] ?? '?';

/** Prefer a real exchange (more than one packet) as the initial selection. */
function defaultScenario(options: Scenario[]): string {
  const multi = options.find((s) => s.id !== 'single');
  return (multi ?? options[0])?.id ?? 'single';
}

/** Human direction label, e.g. "A → B" or "A → ✳" for broadcast/multicast. */
function directionLabel(step: TimelineStep): string {
  const from = step.fromEndpoint >= 0 ? letter(step.fromEndpoint) : '?';
  const to = step.toEndpoint >= 0 ? letter(step.toEndpoint) : '✳';
  return `${from} → ${to}`;
}

export default function ScenarioPage() {
  const layers = useStackStore((s) => s.layers);
  const trailingPayload = useStackStore((s) => s.trailingPayload);
  const registry = useLibraryStore((s) => s.registry);
  const reducedMotion = usePrefersReducedMotion();
  const [inspectionMode, setInspectionMode] = useInspectionMode();

  const base = useMemo<StackInstance>(
    () => ({ layers, trailingPayload }),
    [layers, trailingPayload],
  );
  const options = useMemo(() => applicableScenarios(base, registry), [base, registry]);

  const [scenarioId, setScenarioId] = useState(() => defaultScenario(options));
  // The selection falls back if the stack changed the applicable scenarios; the
  // `<select>` binds to the resolved id so it always reflects what's shown.
  const scenario = options.find((s) => s.id === scenarioId) ?? options[0] ?? null;

  const timeline = useMemo(
    () => (scenario ? deriveTimeline(scenario.generate(base, registry), registry) : null),
    [scenario, base, registry],
  );
  const count = timeline?.steps.length ?? 0;

  const [playback, dispatch] = useReducer(
    (state: Playback, action: PlaybackAction) => reducePlayback(state, action, count),
    initialPlayback,
  );
  // Reset to the first step whenever the step set changes.
  useEffect(() => dispatch({ type: 'reset' }), [timeline]);

  // Auto-advance while playing; reaching the end stops (handled by the reducer).
  useEffect(() => {
    if (!playback.playing) return;
    const id = window.setTimeout(() => dispatch({ type: 'next' }), 1500);
    return () => window.clearTimeout(id);
  }, [playback.playing, playback.step]);

  const stepIndex = Math.min(playback.step, Math.max(0, count - 1));
  const step = timeline?.steps[stepIndex] ?? null;
  const packet = step?.packet ?? null;

  // Keep the active step marker visible in the scrollable strip.
  const stepRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    stepRefs.current[stepIndex]?.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      inline: 'center',
      block: 'nearest',
    });
  }, [stepIndex, reducedMotion]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      dispatch({ type: 'next' });
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      dispatch({ type: 'prev' });
    }
  };

  if (layers.length === 0) {
    return (
      <PageFrame>
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm text-zinc-400">No stack to play.</p>
          <p className="max-w-sm text-[13px] text-zinc-600">
            Build a stack in the Stack Builder first — its packets drive the timeline here.
          </p>
        </div>
      </PageFrame>
    );
  }

  const transition = reducedMotion ? '' : 'transition-colors';

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-6 py-3">
        <h1 className="text-[15px] font-semibold tracking-tight text-zinc-100">
          Scenario Timeline
        </h1>
        <label className="flex items-center gap-2 text-[12px] text-zinc-400">
          <span className="sr-only">Scenario</span>
          <select
            className="cursor-pointer rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[12px] text-zinc-200 outline-none focus:border-cyan-600"
            value={scenario?.id ?? ''}
            onChange={(e) => setScenarioId(e.target.value)}
          >
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {scenario && (
          <span className="text-[12px] text-zinc-500">{scenario.description}</span>
        )}
        <span className="ml-auto font-mono text-[12px] text-zinc-500">
          {count > 0 ? `Step ${stepIndex + 1} of ${count}` : '—'}
        </span>
      </header>

      <section
        aria-label="Packet timeline"
        onKeyDown={onKeyDown}
        className="border-b border-zinc-800 bg-zinc-900/30"
      >
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-6 pt-3">
          <div className="flex items-center gap-3" aria-label="Endpoints">
            {timeline?.endpoints.map((addr, i) => (
              <span key={addr} className="flex items-center gap-1.5">
                <span
                  className={`flex size-5 items-center justify-center rounded text-[11px] font-semibold ${tint(i).bg} ${tint(i).text}`}
                >
                  {letter(i)}
                </span>
                <span className="font-mono text-[12px] text-zinc-400">{addr}</span>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1" role="group" aria-label="Playback controls">
            <button
              className="cursor-pointer rounded-md border border-zinc-700 p-1.5 text-zinc-300 hover:border-cyan-600 hover:text-cyan-300 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600"
              aria-label="Previous packet"
              disabled={stepIndex <= 0}
              onClick={() => dispatch({ type: 'prev' })}
            >
              <SkipBack className="size-3.5" />
            </button>
            <button
              className="cursor-pointer rounded-md border border-cyan-700 bg-cyan-700/20 p-1.5 text-cyan-200 hover:bg-cyan-700/30"
              aria-label={playback.playing ? 'Pause' : 'Play'}
              onClick={() => dispatch({ type: 'toggle' })}
            >
              {playback.playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </button>
            <button
              className="cursor-pointer rounded-md border border-zinc-700 p-1.5 text-zinc-300 hover:border-cyan-600 hover:text-cyan-300 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600"
              aria-label="Next packet"
              disabled={stepIndex >= count - 1}
              onClick={() => dispatch({ type: 'next' })}
            >
              <SkipForward className="size-3.5" />
            </button>
          </div>
          {step && (
            <span className="font-mono text-[12px] text-zinc-500">
              t+{Math.round(step.atUsec / 1000)} ms
            </span>
          )}
          {options.length === 1 && (
            <span className="text-[12px] text-zinc-500">
              No multi-packet exchange for this stack — add TCP, DNS, ICMP, or DHCP to animate one.
            </span>
          )}
        </div>

        <ol className="flex gap-2 overflow-x-auto px-6 py-3">
          {timeline?.steps.map((s, i) => {
            const activeStep = i === stepIndex;
            const from = s.fromEndpoint >= 0 ? s.fromEndpoint : 0;
            return (
              <li key={i} className="shrink-0">
                <button
                  ref={(el) => {
                    stepRefs.current[i] = el;
                  }}
                  aria-current={activeStep ? 'step' : undefined}
                  aria-label={`Step ${i + 1}: ${s.label}, ${directionLabel(s)}`}
                  onClick={() => dispatch({ type: 'select', index: i })}
                  className={`flex w-32 cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2 text-left ${transition} ${
                    activeStep
                      ? `border-transparent ring-2 ${tint(from).ring} ${tint(from).bg}`
                      : 'border-zinc-800 hover:border-zinc-600'
                  }`}
                >
                  <span className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-zinc-500">#{i + 1}</span>
                    <span
                      className={`rounded px-1 text-[10px] font-semibold ${tint(from).text}`}
                    >
                      {directionLabel(s)}
                    </span>
                  </span>
                  <span className="truncate text-[12px] font-medium text-zinc-100" title={s.label}>
                    {s.label}
                  </span>
                  {s.toEndpoint < 0 && (
                    <span className="flex items-center gap-1 text-[10px] text-zinc-500">
                      <Radio className="size-3" aria-hidden /> broadcast
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      <ValidationPanel validation={step?.validation ?? []} serializeIssues={packet?.issues ?? []} />

      {step?.serializeError && (
        <div className="px-6 pb-2 text-[12px] text-rose-400">
          Serialization failed: {step.serializeError}
        </div>
      )}

      <ResizablePanes
        storagePrefix="pv-scenario-pane"
        left={{
          title: 'Field editor',
          children: step && (
            <FieldEditor
              layers={step.stack.layers}
              packet={packet}
              registry={registry}
              readOnly
            />
          ),
        }}
        center={{
          title: 'Packet diagrams',
          children: packet ? (
            <PacketDiagrams packet={packet} registry={registry} />
          ) : (
            <div className="p-6 text-[13px] text-zinc-600">
              No packet to show for this step.
            </div>
          ),
        }}
        right={{
          title: 'Hex dump',
          scrollFocusable: true,
          children: packet && (
            <HexView
              packet={packet}
              registry={registry}
              validation={step?.validation ?? []}
              inspectionMode={inspectionMode}
              onInspectionModeChange={setInspectionMode}
            />
          ),
        }}
      />
    </div>
  );
}

function PageFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-800 px-6 py-3">
        <h1 className="text-[15px] font-semibold tracking-tight text-zinc-100">
          Scenario Timeline
        </h1>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

