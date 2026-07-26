import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  Pause,
  Pencil,
  Play,
  Plus,
  Radio,
  Save,
  SkipBack,
  SkipForward,
  Trash2,
} from 'lucide-react';
import { useNavigate } from 'react-router';
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
import AddToCompareButton from '../components/AddToCompareButton';
import {
  createComposedScenario,
  deriveComposedTimeline,
  duplicateComposedStep,
  snapshotStack,
  type ComposedScenario,
  type ComposedScenarioStep,
} from '../../core/scenarioComposer';
import {
  loadComposedScenario,
  saveComposedScenario,
} from '../../store/composedScenarioPersistence';
import { planExport } from '../../core/exporter';
import { serializeStack } from '../../core/serialize';
import { writePcap, type PcapPacket } from '../../core/pcap';

const ENDPOINT_LETTERS = ['A', 'B', 'C', 'D'];
const ENDPOINT_TINT = [
  { text: 'text-cyan-300', bg: 'bg-cyan-500/15', ring: 'ring-cyan-500/40' },
  { text: 'text-violet-300', bg: 'bg-violet-500/15', ring: 'ring-violet-500/40' },
  { text: 'text-amber-300', bg: 'bg-amber-500/15', ring: 'ring-amber-500/40' },
  { text: 'text-emerald-300', bg: 'bg-emerald-500/15', ring: 'ring-emerald-500/40' },
];
const tint = (i: number) => ENDPOINT_TINT[i] ?? ENDPOINT_TINT[0]!;
const letter = (i: number) => ENDPOINT_LETTERS[i] ?? '?';
const COMPOSED_ID = '__composed__';

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
  const restoreStack = useStackStore((s) => s.restoreStack);
  const reducedMotion = usePrefersReducedMotion();
  const [inspectionMode, setInspectionMode] = useInspectionMode();
  const navigate = useNavigate();

  const base = useMemo<StackInstance>(
    () => ({ layers, trailingPayload }),
    [layers, trailingPayload],
  );
  const options = useMemo(() => applicableScenarios(base, registry), [base, registry]);
  const [composed, setComposed] = useState<ComposedScenario>(() => {
    return loadComposedScenario() ?? createComposedScenario(base);
  });
  const [composerOpen, setComposerOpen] = useState(false);
  const [composedStep, setComposedStep] = useState(0);

  useEffect(() => {
    saveComposedScenario(composed);
  }, [composed]);

  const [scenarioId, setScenarioId] = useState(() => defaultScenario(options));
  // The selection falls back if the stack changed the applicable scenarios; the
  // `<select>` binds to the resolved id so it always reflects what's shown.
  const composedActive = scenarioId === COMPOSED_ID;
  const scenario = composedActive
    ? null
    : options.find((s) => s.id === scenarioId) ?? options[0] ?? null;

  const timeline = useMemo(
    () =>
      composedActive
        ? deriveComposedTimeline(composed, registry)
        : scenario
          ? deriveTimeline(scenario.generate(base, registry), registry)
          : null,
    [composedActive, composed, scenario, base, registry],
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
  const scenarioName = composedActive ? composed.name : scenario?.name;
  const scenarioDescription = composedActive ? composed.description : scenario?.description;

  const editStepInBuilder = (selected: ComposedScenarioStep) => {
    restoreStack(selected.stack.layers, selected.stack.trailingPayload);
    navigate('/builder');
  };

  const downloadComposedPcap = () => {
    if (composed.steps.length === 0) return;
    const exportPlan = planExport(composed.steps[0]!.stack, registry);
    if (!exportPlan.ok || exportPlan.linkType === undefined) return;
    const baseSec = Math.floor(Date.now() / 1000);
    const packets: PcapPacket[] = composed.steps.map((composedPacket) => ({
      bytes: serializeStack(composedPacket.stack, registry).bytes,
      tsSec: baseSec + Math.floor(composedPacket.atUsec / 1_000_000),
      tsUsec: composedPacket.atUsec % 1_000_000,
    }));
    const bytes = writePcap(packets, exportPlan.linkType);
    const url = URL.createObjectURL(
      new Blob([bytes.buffer as ArrayBuffer], { type: 'application/vnd.tcpdump.pcap' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${fileSafe(composed.name)}.pcap`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

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
            value={composedActive ? COMPOSED_ID : scenario?.id ?? ''}
            onChange={(e) => setScenarioId(e.target.value)}
          >
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value={COMPOSED_ID}>Custom · {composed.name}</option>
          </select>
        </label>
        <button
          className="flex cursor-pointer items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[12px] text-zinc-300 hover:border-cyan-600 hover:text-cyan-300"
          aria-expanded={composerOpen}
          onClick={() => {
            setComposerOpen((open) => !open);
            setScenarioId(COMPOSED_ID);
          }}
        >
          <Pencil className="size-3.5" aria-hidden />
          Compose
        </button>
        {composedActive && (
          <button
            className="flex cursor-pointer items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[12px] text-zinc-300 hover:border-cyan-600 hover:text-cyan-300 disabled:text-zinc-600"
            disabled={composed.steps.length === 0}
            onClick={downloadComposedPcap}
          >
            <Download className="size-3.5" aria-hidden />
            Export PCAP
          </button>
        )}
        <AddToCompareButton
          packet={packet}
          label={`${scenarioName ?? 'Scenario'} · #${stepIndex + 1} ${step?.label ?? 'packet'}`}
          labelClass="hidden sm:inline"
        />
      </header>

      {composerOpen && (
        <ScenarioComposer
          scenario={composed}
          selectedIndex={composedStep}
          currentStack={base}
          onChange={setComposed}
          onSelect={(index) => {
            setComposedStep(index);
            dispatch({ type: 'select', index });
          }}
          onEdit={editStepInBuilder}
        />
      )}

      <section
        aria-label="Packet timeline"
        onKeyDown={onKeyDown}
        className="border-b border-zinc-800 bg-zinc-900/30"
      >
        {scenarioDescription && (
          <p className="px-6 pt-3 text-[12px] leading-relaxed text-zinc-500">
            {scenarioDescription}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-6 pt-2">
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
          <span
            className="font-mono text-[12px] text-zinc-500"
            role="status"
            aria-live="polite"
          >
            {count > 0 ? `Step ${stepIndex + 1} of ${count}` : '—'}
          </span>
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

      <ValidationPanel validation={step?.validation ?? []} serializeIssues={packet?.issues ?? []} packet={packet} />

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

function fileSafe(name: string): string {
  return name.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'scenario';
}

function ScenarioComposer({
  scenario,
  selectedIndex,
  currentStack,
  onChange,
  onSelect,
  onEdit,
}: {
  scenario: ComposedScenario;
  selectedIndex: number;
  currentStack: StackInstance;
  onChange: (scenario: ComposedScenario) => void;
  onSelect: (index: number) => void;
  onEdit: (step: ComposedScenarioStep) => void;
}) {
  const [saved, setSaved] = useState(false);
  const selected = scenario.steps[selectedIndex];
  const updateStep = (
    index: number,
    update: (step: ComposedScenarioStep) => ComposedScenarioStep,
  ) =>
    onChange({
      ...scenario,
      steps: scenario.steps.map((step, stepIndex) =>
        stepIndex === index ? update(step) : step,
      ),
    });
  const addStep = () => {
    const atUsec = (scenario.steps.at(-1)?.atUsec ?? -10_000) + 10_000;
    const next: ComposedScenarioStep = {
      id: `step-${Date.now().toString(36)}`,
      label: `packet ${scenario.steps.length + 1}`,
      fromEndpoint: 0,
      toEndpoint: 1,
      atUsec,
      stack: snapshotStack(currentStack),
    };
    onChange({ ...scenario, steps: [...scenario.steps, next] });
    onSelect(scenario.steps.length);
  };
  const duplicate = (index: number) => {
    const next = duplicateComposedStep(scenario.steps[index]!);
    const steps = [...scenario.steps];
    steps.splice(index + 1, 0, next);
    onChange({ ...scenario, steps });
    onSelect(index + 1);
  };
  const move = (index: number, movement: -1 | 1) => {
    const destination = index + movement;
    if (destination < 0 || destination >= scenario.steps.length) return;
    const steps = [...scenario.steps];
    [steps[index], steps[destination]] = [steps[destination]!, steps[index]!];
    onChange({ ...scenario, steps });
    onSelect(destination);
  };
  const remove = (index: number) => {
    const steps = scenario.steps.filter((_, stepIndex) => stepIndex !== index);
    onChange({ ...scenario, steps });
    onSelect(Math.max(0, Math.min(index, steps.length - 1)));
  };

  return (
    <section
      aria-labelledby="scenario-composer-heading"
      className="border-b border-zinc-800 bg-zinc-950/70 px-6 py-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h2 id="scenario-composer-heading" className="text-[14px] font-semibold text-zinc-200">
            Scenario composer
          </h2>
          <p className="text-[11px] text-zinc-500">
            Linear packet snapshots · saved only in this browser
          </p>
        </div>
        <button
          className="flex cursor-pointer items-center gap-1 rounded-md border border-zinc-700 px-2 py-1.5 text-[11px] text-zinc-300 hover:border-cyan-600"
          onClick={() => {
            onChange({ ...scenario });
            setSaved(true);
            window.setTimeout(() => setSaved(false), 1200);
          }}
        >
          <Save className="size-3.5" aria-hidden />
          Save locally
        </button>
        {saved && <span role="status" className="text-[11px] text-emerald-400">Saved</span>}
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-[11px] text-zinc-500">
          Name
          <input
            aria-label="Scenario name"
            value={scenario.name}
            onChange={(event) => onChange({ ...scenario, name: event.target.value })}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[12px] text-zinc-200 outline-none focus:border-cyan-600"
          />
        </label>
        <label className="text-[11px] text-zinc-500 xl:col-span-2">
          Description
          <textarea
            aria-label="Scenario description"
            rows={2}
            value={scenario.description}
            onChange={(event) => onChange({ ...scenario, description: event.target.value })}
            className="mt-1 w-full resize-y rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[12px] text-zinc-200 outline-none focus:border-cyan-600"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          {scenario.endpoints.map((endpoint, index) => (
            <label key={index} className="text-[11px] text-zinc-500">
              Endpoint {letter(index)}
              <input
                aria-label={`Endpoint ${letter(index)}`}
                value={endpoint}
                onChange={(event) => {
                  const endpoints: [string, string] = [...scenario.endpoints];
                  endpoints[index] = event.target.value;
                  onChange({ ...scenario, endpoints });
                }}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[12px] text-zinc-200 outline-none focus:border-cyan-600"
              />
            </label>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <h3 className="text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
          Steps
        </h3>
        <button
          className="flex cursor-pointer items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-cyan-600"
          onClick={addStep}
        >
          <Plus className="size-3" aria-hidden />
          Add current packet
        </button>
      </div>

      <ol className="mt-2 flex gap-2 overflow-x-auto pb-2">
        {scenario.steps.map((step, index) => (
          <li
            key={step.id}
            className={`w-72 shrink-0 rounded-lg border p-3 ${
              index === selectedIndex
                ? 'border-cyan-700 bg-cyan-500/5'
                : 'border-zinc-800 bg-zinc-900/40'
            }`}
          >
            <button
              className="mb-2 w-full cursor-pointer text-left text-[11px] font-medium text-zinc-400 hover:text-cyan-300"
              aria-label={`Preview step ${index + 1}: ${step.label}`}
              onClick={() => onSelect(index)}
            >
              Step {index + 1}
            </button>
            <label className="block text-[10px] text-zinc-500">
              Label
              <input
                aria-label={`Step ${index + 1} label`}
                value={step.label}
                onChange={(event) =>
                  updateStep(index, (current) => ({ ...current, label: event.target.value }))
                }
                className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[12px] text-zinc-200"
              />
            </label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <EndpointSelect
                label="From"
                value={step.fromEndpoint}
                endpoints={scenario.endpoints}
                onChange={(value) =>
                  updateStep(index, (current) => ({ ...current, fromEndpoint: value }))
                }
              />
              <EndpointSelect
                label="To"
                value={step.toEndpoint}
                endpoints={scenario.endpoints}
                onChange={(value) =>
                  updateStep(index, (current) => ({ ...current, toEndpoint: value }))
                }
              />
              <label className="text-[10px] text-zinc-500">
                Time ms
                <input
                  aria-label={`Step ${index + 1} time in milliseconds`}
                  type="number"
                  min={0}
                  step={1}
                  value={step.atUsec / 1000}
                  onChange={(event) =>
                    updateStep(index, (current) => ({
                      ...current,
                      atUsec: Math.max(0, Math.round(Number(event.target.value) * 1000)),
                    }))
                  }
                  className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-[11px] text-zinc-200"
                />
              </label>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <StepAction label={`Move step ${index + 1} earlier`} disabled={index === 0} onClick={() => move(index, -1)} icon={ArrowUp} />
              <StepAction label={`Move step ${index + 1} later`} disabled={index === scenario.steps.length - 1} onClick={() => move(index, 1)} icon={ArrowDown} />
              <StepAction label={`Duplicate step ${index + 1}`} onClick={() => duplicate(index)} icon={Copy} />
              <StepAction label={`Delete step ${index + 1}`} onClick={() => remove(index)} icon={Trash2} />
            </div>
          </li>
        ))}
      </ol>

      {selected && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
          Selected packet: {selected.stack.layers.map((layer) => layer.protocolId).join(' → ')}
          <button
            className="cursor-pointer rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:border-cyan-600"
            onClick={() =>
              updateStep(selectedIndex, (step) => ({
                ...step,
                stack: snapshotStack(currentStack),
              }))
            }
          >
            Update from current Builder packet
          </button>
          <button
            className="flex cursor-pointer items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:border-cyan-600"
            onClick={() => onEdit(selected)}
          >
            <Pencil className="size-3" aria-hidden />
            Edit fields in Builder
          </button>
        </div>
      )}
    </section>
  );
}

function EndpointSelect({
  label,
  value,
  endpoints,
  onChange,
}: {
  label: string;
  value: 0 | 1;
  endpoints: [string, string];
  onChange: (value: 0 | 1) => void;
}) {
  return (
    <label className="text-[10px] text-zinc-500">
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(Number(event.target.value) as 0 | 1)}
        className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-950 px-1 py-1 text-[11px] text-zinc-200"
      >
        {endpoints.map((endpoint, index) => (
          <option key={index} value={index}>
            {letter(index)} · {endpoint}
          </option>
        ))}
      </select>
    </label>
  );
}

function StepAction({
  label,
  disabled = false,
  onClick,
  icon: Icon,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  icon: typeof ArrowUp;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      className="cursor-pointer rounded border border-zinc-700 p-1 text-zinc-400 hover:border-cyan-600 hover:text-cyan-300 disabled:cursor-not-allowed disabled:text-zinc-700"
      onClick={onClick}
    >
      <Icon className="size-3" aria-hidden />
    </button>
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
