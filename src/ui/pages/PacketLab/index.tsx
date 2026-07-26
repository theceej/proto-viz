import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeftRight, RotateCcw } from 'lucide-react';
import type { StackInstance } from '../../../core/model';
import { useStackStore } from '../../../store/stackStore';

/**
 * The tabs stay in separate chunks. Joining the labs should not mean someone
 * who only wants to fragment a datagram downloads the fuzzer as well —
 * sharing a shell is a UI decision, not a bundling one.
 */
const FragmentationTab = lazy(() => import('./FragmentationTab'));
const FuzzingTab = lazy(() => import('./FuzzingTab'));
import { isLabTab, LAB_TABS, TAB_COPY, type LabSource, type LabTab } from './source';

/**
 * The Packet Lab: the two destructive workbenches, sharing a shell and — more
 * to the point — able to hand packets to each other.
 *
 * Fragmentation and fuzzing were separate pages that each read the Stack
 * Builder and ignored the other's existence, which left the interesting
 * question unaskable: what happens to reassembly when one fragment is
 * corrupted? Here each tab holds a *source packet* that defaults to the
 * builder's stack but can be a packet the other tab produced, so "fuzz this
 * fragment" and "fragment this fuzzed packet" are one click each.
 *
 * The tab lives in the URL (`/lab/fuzzing`) so a link points where it says it
 * does and the back button steps between tabs. Sources are per-tab: sending a
 * fragment to the fuzzer does not disturb what fragmentation itself is
 * working on.
 */
export default function PacketLabPage() {
  const { tab: tabParam } = useParams();
  const navigate = useNavigate();
  const layers = useStackStore((state) => state.layers);
  const trailingPayload = useStackStore((state) => state.trailingPayload);

  const tab: LabTab = isLabTab(tabParam) ? tabParam : 'fragmentation';
  const [sources, setSources] = useState<Partial<Record<LabTab, LabSource>>>({});

  const builderSource = useMemo<LabSource>(
    () => ({
      label: 'Stack Builder packet',
      origin: 'builder',
      stack: { layers, trailingPayload } satisfies StackInstance,
    }),
    [layers, trailingPayload],
  );

  const sourceFor = (which: LabTab): LabSource => sources[which] ?? builderSource;
  const resetSource = (which: LabTab) =>
    setSources((current) => {
      const next = { ...current };
      delete next[which];
      return next;
    });
  const handoff = (to: LabTab) => (source: LabSource) => {
    setSources((current) => ({ ...current, [to]: source }));
    navigate(`/lab/${to}`);
  };

  if (layers.length === 0) {
    return (
      <LabFrame tab={tab}>
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
          <h2 className="text-sm font-semibold text-zinc-200">No packet to work on</h2>
          <p className="max-w-md text-[13px] text-zinc-500">
            Both labs read the current Stack Builder packet without changing it. Build a stack
            first, then come back to fragment or corrupt it.
          </p>
          <Link
            to="/builder"
            className="mt-2 rounded-md bg-cyan-700 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-cyan-600"
          >
            Open Stack Builder
          </Link>
        </div>
      </LabFrame>
    );
  }

  const source = sourceFor(tab);

  return (
    <LabFrame tab={tab}>
      {source.origin !== 'builder' && (
        <p className="flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-cyan-500/5 px-4 py-1.5 text-[12px] text-cyan-200 sm:px-6">
          <ArrowLeftRight className="size-3.5 shrink-0" aria-hidden />
          Working on <span className="font-medium">{source.label}</span>
          <span className="text-zinc-500">
            handed over from the {TAB_COPY[source.origin].label.toLowerCase()} tab
          </span>
          <button
            className="flex cursor-pointer items-center gap-1 rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-300 hover:border-cyan-600 hover:text-cyan-300"
            onClick={() => resetSource(tab)}
          >
            <RotateCcw className="size-3" aria-hidden />
            Use the Builder packet
          </button>
        </p>
      )}

      <Suspense fallback={null}>
        {tab === 'fragmentation' ? (
          <FragmentationTab source={source} onHandoff={handoff('fuzzing')} />
        ) : (
          <FuzzingTab source={source} onHandoff={handoff('fragmentation')} />
        )}
      </Suspense>
    </LabFrame>
  );
}

/** Title, tab bar, and the blurb for whichever tab is showing. */
function LabFrame({ tab, children }: { tab: LabTab; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-800 px-4 py-3 sm:px-6">
        <div className="mr-auto">
          <h1 className="text-[15px] font-semibold tracking-tight text-zinc-100">Packet Lab</h1>
          <p className="text-[11px] text-zinc-500">{TAB_COPY[tab].blurb}</p>
        </div>
        <div className="flex items-center gap-1" role="tablist" aria-label="Lab">
          {LAB_TABS.map((option) => (
            <Link
              key={option}
              to={`/lab/${option}`}
              role="tab"
              aria-selected={tab === option}
              className={`cursor-pointer rounded-md px-3 py-1 text-[12px] font-medium ${
                tab === option
                  ? 'bg-cyan-500/15 text-cyan-300'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {TAB_COPY[option].label}
            </Link>
          ))}
        </div>
      </header>
      {children}
    </div>
  );
}
