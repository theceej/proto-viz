import { lazy, Suspense, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Dices,
  Download,
  PlayCircle,
  Scissors,
  Search,
  Share2,
} from 'lucide-react';
import {
  FuzzError,
  fuzzPacket,
  isLengthChanging,
  MUTATIONS,
  type FuzzResult,
  type MutationStrategy,
} from '../../../core/fuzz';
import { diagnoseFuzz, type DiagnosisSeverity } from '../../../core/fuzzDiagnosis';
import { MAX_RUNS, runCampaign, type CampaignResult } from '../../../core/fuzzCampaign';
import { serializeStack } from '../../../core/serialize';
import { useLibraryStore } from '../../../store/libraryStore';
import { useStackStore } from '../../../store/stackStore';
import HexView from '../../components/HexView';
import PacketDiagrams from '../../components/PacketDiagrams';
import PlainHexView from '../../components/PlainHexView';
import ResizablePanes from '../../components/ResizablePanes';
import { useInspectionMode } from '../../inspectionMode';
import type { LabTabProps } from './source';

const ExportDialog = lazy(() => import('../../components/ExportDialog'));
const ShareDialog = lazy(() => import('../../components/ShareDialog'));

const STRATEGY_COPY: Record<MutationStrategy, { label: string; description: string }> = {
  'bit-flip': { label: 'Random bit flips', description: 'Flip single bits, as a noisy link would.' },
  zero: { label: 'Zero bytes', description: 'Blank whole bytes, as a truncating middlebox might.' },
  boundary: {
    label: 'Boundary values',
    description: 'Write 0x00, 0xFF, 0x7F, 0x80 — where off-by-one and sign bugs live.',
  },
  'length-overflow': {
    label: 'Length overflow',
    description: 'Drive a length, offset or count field to its maximum.',
  },
  truncate: { label: 'Truncate', description: 'Cut the packet short of what its headers claim.' },
  extend: { label: 'Extend', description: 'Append trailing bytes nothing accounts for.' },
};

const SEVERITY_STYLE: Record<DiagnosisSeverity, { icon: typeof CheckCircle2; className: string }> = {
  ok: { icon: CheckCircle2, className: 'text-emerald-300' },
  warning: { icon: AlertTriangle, className: 'text-amber-300' },
  error: { icon: CircleAlert, className: 'text-rose-300' },
};

type Tab = 'single' | 'campaign';

/**
 * The fuzzing and fault-injection lab.
 *
 * `experiments.ts` answers "show me a broken checksum"; this answers "what
 * happens if I corrupt *this*". A scope, a strategy and a seed produce a
 * mutated packet, and the diagnosis panel reports what a receiver would make
 * of it — how far a dissector gets, and which checks the mutation newly
 * fails. The seed is the point: a corrupted packet here is nameable and
 * reproducible rather than a one-off accident.
 *
 * Nothing is transmitted. This mutates a packet the user composed, in their
 * own tab, exactly as every other view in the app does.
 */
export default function FuzzingTab({ source, onHandoff }: LabTabProps) {
  const restoreStack = useStackStore((state) => state.restoreStack);
  const registry = useLibraryStore((state) => state.registry);
  const navigate = useNavigate();
  const [inspectionMode, setInspectionMode] = useInspectionMode();

  const [tab, setTab] = useState<Tab>('single');
  const [seed, setSeed] = useState(4242);
  const [strategy, setStrategy] = useState<MutationStrategy>('bit-flip');
  const [count, setCount] = useState(3);
  const [selectedLayers, setSelectedLayers] = useState<string[]>([]);
  const [allowLengthChange, setAllowLengthChange] = useState(false);
  const [campaignRuns, setCampaignRuns] = useState(50);
  const [campaign, setCampaign] = useState<CampaignResult | null>(null);
  const [exporting, setExporting] = useState(false);
  const [sharing, setSharing] = useState(false);

  const baseline = source.stack;
  const basePacket = useMemo(() => {
    try {
      return baseline.layers.length > 0 ? serializeStack(baseline, registry) : null;
    } catch {
      return null;
    }
  }, [baseline, registry]);

  const run = useMemo(() => {
    if (!basePacket) return null;
    try {
      const result = fuzzPacket(baseline, basePacket, registry, {
        seed,
        strategy,
        count,
        target: { layerUids: selectedLayers },
        allowLengthChange,
      });
      return {
        result,
        diagnosis: diagnoseFuzz({ stack: baseline, packet: basePacket }, result, registry),
        error: null,
      };
    } catch (e) {
      return {
        result: null,
        diagnosis: null,
        error: e instanceof FuzzError ? e.message : (e as Error).message,
      };
    }
  }, [baseline, basePacket, registry, seed, strategy, count, selectedLayers, allowLengthChange]);

  const mutatedPacket = useMemo(() => {
    if (!run?.result?.stack) return null;
    try {
      return serializeStack(run.result.stack, registry);
    } catch {
      return null;
    }
  }, [run, registry]);

  const strategies = MUTATIONS.filter((option) => allowLengthChange || !isLengthChanging(option));

  const toggleLayer = (uid: string) =>
    setSelectedLayers((current) =>
      current.includes(uid) ? current.filter((id) => id !== uid) : [...current, uid],
    );

  const loadIntoBuilder = (result: FuzzResult) => {
    if (!result.stack) return;
    restoreStack(result.stack.layers, result.stack.trailingPayload);
    navigate('/builder');
  };

  if (!basePacket) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm text-zinc-400">This packet could not be serialized.</p>
        <p className="max-w-sm text-[13px] text-zinc-600">
          Fix the stack in the Stack Builder, or switch back to the Builder packet.
        </p>
      </div>
    );
  }

  return (
    <>
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-4 py-3 sm:px-6">
        <span className="font-mono text-[12px] text-zinc-500">
          {basePacket.bytes.length}-byte packet ·{' '}
          {basePacket.layers.map((l) => l.protocolId).join(' › ')}
        </span>
        <div className="ml-auto flex items-center gap-1" role="tablist" aria-label="Fuzzing mode">
          <TabButton active={tab === 'single'} onClick={() => setTab('single')}>
            Single packet
          </TabButton>
          <TabButton active={tab === 'campaign'} onClick={() => setTab('campaign')}>
            Campaign
          </TabButton>
        </div>
      </header>

      <section
        aria-label="Fuzzing controls"
        className="flex flex-wrap items-end gap-4 border-b border-zinc-800 bg-zinc-900/30 px-4 py-3 sm:px-6"
      >
        <label className="flex flex-col gap-1 text-[11px] tracking-widest text-zinc-500 uppercase">
          Strategy
          <select
            className={FIELD}
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as MutationStrategy)}
          >
            {strategies.map((option) => (
              <option key={option} value={option}>
                {STRATEGY_COPY[option].label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[11px] tracking-widest text-zinc-500 uppercase">
          Seed
          <span className="flex items-center gap-1">
            <input
              type="number"
              className={`${FIELD} w-24 font-mono`}
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value) || 0)}
            />
            <button
              className="cursor-pointer rounded-md border border-zinc-700 p-1.5 text-zinc-400 hover:border-cyan-600 hover:text-cyan-300"
              aria-label="Random seed"
              onClick={() => setSeed(Math.floor(Math.random() * 100000))}
            >
              <Dices className="size-3.5" aria-hidden />
            </button>
          </span>
        </label>

        <label className="flex flex-col gap-1 text-[11px] tracking-widest text-zinc-500 uppercase">
          Mutations
          <input
            type="number"
            min={1}
            max={64}
            className={`${FIELD} w-20 font-mono`}
            value={count}
            onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>

        <fieldset className="flex flex-col gap-1">
          <legend className="text-[11px] tracking-widest text-zinc-500 uppercase">Target</legend>
          <div className="flex flex-wrap items-center gap-2">
            {basePacket.layers.map((layout) => (
              <label
                key={layout.uid}
                className="flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-800 px-2 py-1 text-[12px] text-zinc-300 hover:border-zinc-600"
              >
                <input
                  type="checkbox"
                  className="accent-cyan-500"
                  checked={selectedLayers.includes(layout.uid)}
                  onChange={() => toggleLayer(layout.uid)}
                />
                {registry.get(layout.protocolId)?.name ?? layout.protocolId}
              </label>
            ))}
            {selectedLayers.length === 0 && (
              <span className="text-[11px] text-zinc-600">whole packet</span>
            )}
          </div>
        </fieldset>

        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-zinc-400">
          <input
            type="checkbox"
            className="accent-amber-500"
            checked={allowLengthChange}
            onChange={(e) => {
              setAllowLengthChange(e.target.checked);
              // Falling back keeps the selection valid when the advanced
              // strategies disappear again.
              if (!e.target.checked && isLengthChanging(strategy)) setStrategy('bit-flip');
            }}
          />
          Allow length-changing mutations
          <span className="text-[11px] text-zinc-600">(truncate, extend)</span>
        </label>
      </section>

      <p className="border-b border-zinc-800 px-4 py-1.5 text-[12px] text-zinc-500 sm:px-6">
        {STRATEGY_COPY[strategy].description} Everything happens in this tab — nothing is sent
        anywhere.
      </p>

      {tab === 'single' ? (
        <SinglePane
          run={run}
          mutatedPacket={mutatedPacket}
          registry={registry}
          inspectionMode={inspectionMode}
          onInspectionModeChange={setInspectionMode}
          onExport={() => setExporting(true)}
          onShare={() => setSharing(true)}
          onInspect={loadIntoBuilder}
          onFragment={(result) => {
            if (!result.stack) return;
            onHandoff({
              label: `Fuzzed: seed ${seed}, ${STRATEGY_COPY[strategy].label.toLowerCase()}`,
              origin: 'fuzzing',
              stack: result.stack,
            });
          }}
        />
      ) : (
        <CampaignPane
          campaign={campaign}
          runs={campaignRuns}
          onRunsChange={setCampaignRuns}
          onRun={() =>
            setCampaign(
              runCampaign(baseline, basePacket, registry, {
                startSeed: seed,
                runs: campaignRuns,
                strategies: [strategy],
                count,
                target: { layerUids: selectedLayers },
                allowLengthChange,
              }),
            )
          }
          onOpenSeed={(pick) => {
            setSeed(pick);
            setTab('single');
          }}
        />
      )}

      <Suspense fallback={null}>
        {exporting && run?.result?.stack && (
          <ExportDialog
            stack={run.result.stack}
            registry={registry}
            validation={[]}
            onWrapInEthernet={null}
            onClose={() => setExporting(false)}
          />
        )}
        {sharing && run?.result?.stack && (
          <ShareDialog
            stack={run.result.stack}
            registry={registry}
            onClose={() => setSharing(false)}
          />
        )}
      </Suspense>
    </>
  );
}

const FIELD =
  'rounded-md border border-zinc-700 bg-zinc-950/60 px-2 py-1.5 text-[12px] text-zinc-200 outline-none focus:border-cyan-600';

interface RunState {
  result: FuzzResult | null;
  diagnosis: ReturnType<typeof diagnoseFuzz> | null;
  error: string | null;
}

function SinglePane({
  run,
  mutatedPacket,
  registry,
  inspectionMode,
  onInspectionModeChange,
  onExport,
  onShare,
  onInspect,
  onFragment,
}: {
  run: RunState | null;
  mutatedPacket: ReturnType<typeof serializeStack> | null;
  registry: ReturnType<typeof useLibraryStore.getState>['registry'];
  inspectionMode: ReturnType<typeof useInspectionMode>[0];
  onInspectionModeChange: ReturnType<typeof useInspectionMode>[1];
  onExport: () => void;
  onShare: () => void;
  onInspect: (result: FuzzResult) => void;
  onFragment: (result: FuzzResult) => void;
}) {
  if (!run) return null;
  if (run.error !== null || !run.result || !run.diagnosis) {
    return (
      <p role="alert" className="px-4 py-6 text-[13px] text-amber-300 sm:px-6">
        {run.error ?? 'No mutation could be produced.'}
      </p>
    );
  }
  const { result, diagnosis } = run;
  const mutatedBits = result.mutations.map((mutation) => ({
    bitOffset: mutation.bitOffset,
    bitLength: mutation.bitLength,
  }));

  return (
    <>
      <section
        aria-label="Mutation result"
        className="flex flex-wrap items-start gap-x-6 gap-y-3 border-b border-zinc-800 px-4 py-3 sm:px-6"
      >
        <div className="min-w-0 flex-1">
          <h2 className="mb-1 text-[11px] tracking-widest text-zinc-500 uppercase">
            {result.mutations.length} mutation{result.mutations.length === 1 ? '' : 's'}
          </h2>
          <ul className="flex flex-col gap-0.5">
            {result.mutations.map((mutation, i) => (
              <li key={i} className="font-mono text-[12px] text-zinc-300">
                {mutation.description}
              </li>
            ))}
          </ul>
          {result.foldbackNote && (
            <p className="mt-1.5 text-[12px] text-amber-300">{result.foldbackNote}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className={ACTION} disabled={!result.stack} onClick={onExport}>
            <Download className="size-3.5" aria-hidden />
            Export PCAP
          </button>
          <button className={ACTION} disabled={!result.stack} onClick={onShare}>
            <Share2 className="size-3.5" aria-hidden />
            Share
          </button>
          <button
            className={ACTION}
            disabled={!result.stack}
            title="Fragment this corrupted packet and see whether reassembly survives it"
            onClick={() => onFragment(result)}
          >
            <Scissors className="size-3.5" aria-hidden />
            Fragment this packet
          </button>
          <button className={ACTION} disabled={!result.stack} onClick={() => onInspect(result)}>
            <Search className="size-3.5" aria-hidden />
            Open in Stack Builder
          </button>
        </div>
      </section>

      <section aria-label="Diagnosis" className="border-b border-zinc-800 px-4 py-3 sm:px-6">
        <ol className="flex flex-col gap-2">
          {diagnosis.steps.map((step, i) => {
            const { icon: Icon, className } = SEVERITY_STYLE[step.severity];
            return (
              <li key={i} className="flex items-start gap-2">
                <Icon className={`mt-0.5 size-3.5 shrink-0 ${className}`} aria-hidden />
                <span className="min-w-0">
                  <span className={`text-[13px] font-medium ${className}`}>
                    {step.severity === 'error' ? 'Fails: ' : step.severity === 'warning' ? 'Warns: ' : 'Passes: '}
                    {step.title}
                  </span>
                  <span className="block text-[12px] leading-relaxed text-zinc-400">
                    {step.detail}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
        {(diagnosis.introducedValidation.length > 0 || diagnosis.introducedLint.length > 0) && (
          <ul className="mt-2 flex flex-col gap-1 border-t border-zinc-800 pt-2">
            {diagnosis.introducedValidation.map((issue, i) => (
              <li key={`v${i}`} className="text-[12px] text-rose-300">
                {issue.message}
              </li>
            ))}
            {diagnosis.introducedLint.map((issue, i) => (
              <li key={`l${i}`} className="text-[12px] text-amber-300">
                {issue.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      {mutatedPacket ? (
        <ResizablePanes
          storagePrefix="pv-fuzz-pane"
          left={{
            title: 'Packet diagrams',
            children: (
              <PacketDiagrams
                packet={mutatedPacket}
                registry={registry}
                mutatedBits={mutatedBits}
              />
            ),
          }}
          center={{
            title: 'Hex dump',
            scrollFocusable: true,
            children: (
              <HexView
                packet={mutatedPacket}
                registry={registry}
                inspectionMode={inspectionMode}
                onInspectionModeChange={onInspectionModeChange}
                mutatedBits={mutatedBits}
              />
            ),
          }}
          right={{
            title: 'Raw bytes',
            scrollFocusable: true,
            children: (
              <div className="p-3">
                <PlainHexView bytes={result.bytes} ranges={byteRanges(mutatedBits)} />
              </div>
            ),
          }}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-6">
          <p className="mb-3 max-w-2xl text-[13px] text-zinc-400">
            This packet no longer maps onto a stack, so the field and diagram views cannot
            describe it — which is exactly the point of the mutation. The bytes below are what a
            receiver would actually see.
          </p>
          <PlainHexView bytes={result.bytes} ranges={byteRanges(mutatedBits)} />
        </div>
      )}
    </>
  );
}

function CampaignPane({
  campaign,
  runs,
  onRunsChange,
  onRun,
  onOpenSeed,
}: {
  campaign: CampaignResult | null;
  runs: number;
  onRunsChange: (runs: number) => void;
  onRun: () => void;
  onOpenSeed: (seed: number) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[11px] tracking-widest text-zinc-500 uppercase">
          Runs
          <input
            type="number"
            min={1}
            max={MAX_RUNS}
            className={`${FIELD} w-24 font-mono`}
            value={runs}
            onChange={(e) => onRunsChange(Math.max(1, Math.min(MAX_RUNS, Number(e.target.value) || 1)))}
          />
        </label>
        <button
          className="flex cursor-pointer items-center gap-1.5 rounded-md bg-cyan-700 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-cyan-600"
          onClick={onRun}
        >
          <PlayCircle className="size-4" aria-hidden />
          Run campaign
        </button>
        <p className="text-[12px] text-zinc-500">
          Consecutive seeds from the one above, so any row can be reopened exactly.
        </p>
      </div>

      {!campaign ? (
        <p className="text-[13px] text-zinc-600">
          A campaign runs the current strategy across many seeds and groups the results, which is
          how you find the few mutations that actually break something.
        </p>
      ) : (
        <>
          <table className="w-full border-collapse text-[12px]">
            <caption className="sr-only">Campaign outcomes, worst first</caption>
            <thead>
              <tr className="text-zinc-400">
                <th scope="col" className="border-b border-zinc-800 px-3 py-1.5 text-left font-medium">
                  Outcome
                </th>
                <th scope="col" className="w-20 border-b border-zinc-800 px-3 py-1.5 text-right font-medium">
                  Runs
                </th>
                <th scope="col" className="border-b border-zinc-800 px-3 py-1.5 text-left font-medium">
                  Seeds
                </th>
              </tr>
            </thead>
            <tbody>
              {campaign.groups.map((group) => (
                <tr key={group.outcome} className="border-b border-zinc-900">
                  <td className="px-3 py-1.5 text-zinc-200">{group.label}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-zinc-300">{group.count}</td>
                  <td className="px-3 py-1.5">
                    <span className="flex flex-wrap gap-1">
                      {group.seeds.slice(0, 12).map((seed) => (
                        <button
                          key={seed}
                          className="cursor-pointer rounded border border-zinc-700 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300 hover:border-cyan-600 hover:text-cyan-300"
                          aria-label={`Open seed ${seed}`}
                          onClick={() => onOpenSeed(seed)}
                        >
                          {seed}
                        </button>
                      ))}
                      {group.seeds.length > 12 && (
                        <span className="self-center text-[11px] text-zinc-600">
                          +{group.seeds.length - 12} more
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[12px] text-zinc-500" role="status">
            {campaign.runs.length} runs ·{' '}
            {campaign.runs.filter((run) => run.outcome !== 'decodes-cleanly').length} changed how the
            packet is read.
          </p>
        </>
      )}
    </div>
  );
}

const ACTION =
  'flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1.5 text-[12px] text-zinc-300 hover:border-cyan-600 hover:text-cyan-300 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600';

/** Bit ranges as byte ranges, for the plain hex view. */
function byteRanges(
  bits: { bitOffset: number; bitLength: number }[],
): { offset: number; length: number }[] {
  return bits.map((range) => {
    const first = Math.floor(range.bitOffset / 8);
    const last = Math.floor((range.bitOffset + Math.max(1, range.bitLength) - 1) / 8);
    return { offset: first, length: last - first + 1 };
  });
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`cursor-pointer rounded-md px-3 py-1 text-[12px] font-medium ${
        active ? 'bg-cyan-500/15 text-cyan-300' : 'text-zinc-400 hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  );
}
