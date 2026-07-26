import { useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent } from 'react';
import { Bug, Download, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { Link } from 'react-router';
import {
  FRAGMENT_MUTATIONS,
  analyzeReassembly,
  discoverFragmentableIpLayers,
  fragmentPacket,
  mutateFragmentSequence,
  type FragmentIssue,
  type FragmentMutation,
} from '../../../core/fragmentation';
import { planExport } from '../../../core/exporter';

import { writePcap } from '../../../core/pcap';
import { deriveTimeline, initialPlayback, reducePlayback } from '../../../core/timeline';
import { useLibraryStore } from '../../../store/libraryStore';
import AddToCompareButton from '../../components/AddToCompareButton';
import FieldEditor from '../../components/FieldEditor';
import HexView from '../../components/HexView';
import PacketDiagrams from '../../components/PacketDiagrams';
import ResizablePanes from '../../components/ResizablePanes';
import ValidationPanel from '../../components/ValidationPanel';
import { useInspectionMode } from '../../inspectionMode';
import { usePrefersReducedMotion } from '../../usePrefersReducedMotion';
import type { LabTabProps } from './source';

const EMPTY_PAYLOAD = new Uint8Array(0);

const MODE_COPY: Record<FragmentMutation, { label: string; description: string }> = {
  normal: { label: 'Normal', description: 'Every fragment arrives once, in offset order.' },
  missing: { label: 'Missing', description: 'One middle fragment is removed, leaving a byte gap.' },
  duplicate: { label: 'Duplicate', description: 'One exact repeat arrives and should be ignored.' },
  overlap: { label: 'Overlap', description: 'A fragment moves back eight bytes, making ownership ambiguous.' },
  'out-of-order': { label: 'Out of order', description: 'The first two arrivals are swapped; offsets still permit reassembly.' },
};

export default function FragmentationTab({ source, onHandoff }: LabTabProps) {
  const registry = useLibraryStore((state) => state.registry);
  const [selectedUid, setSelectedUid] = useState('');
  const [mtu, setMtu] = useState(1280);
  const [mode, setMode] = useState<FragmentMutation>('normal');
  const [inspectionMode, setInspectionMode] = useInspectionMode();
  const reducedMotion = usePrefersReducedMotion();

  const stack = source.stack;
  const trailingPayload = stack.trailingPayload ?? EMPTY_PAYLOAD;
  const candidates = useMemo(
    () => discoverFragmentableIpLayers(stack, registry),
    [stack, registry],
  );
  const selected = candidates.find((candidate) => candidate.uid === selectedUid) ?? candidates[0];
  const ipv6Identification = useMemo(
    () => stableIdentification(selected?.uid ?? '', trailingPayload),
    [selected?.uid, trailingPayload],
  );
  const result = useMemo(
    () => selected
      ? fragmentPacket({
          stack,
          registry,
          layerUid: selected.uid,
          mtu,
          identification: selected.version === 6 ? ipv6Identification : undefined,
        })
      : null,
    [stack, registry, selected, mtu, ipv6Identification],
  );
  const sequence = useMemo(
    () => result?.ok ? mutateFragmentSequence(result.sequence, mode, registry) : null,
    [result, mode, registry],
  );
  const timeline = useMemo(
    () => sequence
      ? deriveTimeline(sequence.fragments.map((fragment, index) => ({
          label: `Fragment ${index + 1}`,
          atUsec: index * 100_000,
          stack: fragment.stack,
        })), registry)
      : null,
    [sequence, registry],
  );
  const reassembly = useMemo(
    () => sequence ? analyzeReassembly(sequence.fragments) : [],
    [sequence],
  );
  const count = timeline?.steps.length ?? 0;
  const [playback, dispatch] = useReducer(
    (state: typeof initialPlayback, action: Parameters<typeof reducePlayback>[1]) =>
      reducePlayback(state, action, count),
    initialPlayback,
  );

  useEffect(() => dispatch({ type: 'reset' }), [timeline]);
  useEffect(() => {
    if (!playback.playing) return;
    const timer = window.setTimeout(() => dispatch({ type: 'next' }), 1200);
    return () => window.clearTimeout(timer);
  }, [playback.playing, playback.step]);

  const stepIndex = Math.min(playback.step, Math.max(0, count - 1));
  const step = timeline?.steps[stepIndex] ?? null;
  const state = reassembly[stepIndex] ?? null;
  const finalState = reassembly.at(-1) ?? null;
  const exactMatch = Boolean(
    finalState?.reassembledPayload && sequence && bytesEqual(finalState.reassembledPayload, sequence.originalPayload),
  );
  const exportPlan = useMemo(
    () => sequence?.fragments[0] ? planExport(sequence.fragments[0].stack, registry) : null,
    [sequence, registry],
  );
  const stepRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    stepRefs.current[stepIndex]?.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [stepIndex, reducedMotion]);

  const onTimelineKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    dispatch({ type: event.key === 'ArrowRight' ? 'next' : 'prev' });
  };

  const downloadPcap = () => {
    if (!sequence || !exportPlan?.ok || exportPlan.linkType === undefined) return;
    const baseSec = Math.floor(Date.now() / 1000);
    const file = writePcap(sequence.fragments.map((item, index) => {
      const atUsec = index * 100_000;
      return {
        bytes: item.packet.bytes,
        tsSec: baseSec + Math.floor(atUsec / 1_000_000),
        tsUsec: atUsec % 1_000_000,
      };
    }), exportPlan.linkType);
    const url = URL.createObjectURL(
      new Blob([file.buffer as ArrayBuffer], { type: 'application/vnd.tcpdump.pcap' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `fragmentation-${mode}-ipv${sequence.version}.pcap`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (candidates.length === 0) {
    return <Unavailable title="This packet has no IP layer" detail="Add an IPv4 or IPv6 layer in Stack Builder, then return to explore fragmentation." />;
  }

  return (
    <>
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-4 py-3 sm:px-6">
        {candidates.length > 1 && (
          <label className="text-[11px] text-zinc-500">
            IP layer
            <select
              aria-label="IP layer to fragment"
              value={selected?.uid ?? ''}
              onChange={(event) => setSelectedUid(event.target.value)}
              className="ml-2 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[12px] text-zinc-200 outline-none focus:border-cyan-600"
            >
              {candidates.map((candidate) => (
                <option key={candidate.uid} value={candidate.uid}>
                  IPv{candidate.version} · layer {candidate.layerIndex + 1}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-[11px] text-zinc-500">
          MTU (bytes)
          <input
            aria-label="Maximum transmission unit in bytes"
            type="number"
            min={1}
            step={1}
            value={mtu}
            onChange={(event) => setMtu(Number(event.target.value))}
            className="ml-2 w-24 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-[12px] text-zinc-200 outline-none focus:border-cyan-600"
          />
        </label>
        <button
          disabled={!sequence || !exportPlan?.ok}
          title={exportPlan?.blockedReason ?? 'Export all arrivals as PCAP'}
          onClick={downloadPcap}
          className="flex cursor-pointer items-center gap-1 rounded-md border border-zinc-700 px-2 py-1.5 text-[12px] text-zinc-300 hover:border-cyan-600 hover:text-cyan-300 disabled:cursor-not-allowed disabled:text-zinc-600"
        >
          <Download className="size-3.5" aria-hidden /> Export PCAP
        </button>
        <AddToCompareButton
          packet={step?.packet ?? null}
          label={`Fragmentation ${mode} · arrival ${stepIndex + 1}`}
          labelClass="hidden sm:inline"
        />
        <button
          disabled={!sequence?.fragments[stepIndex]}
          title="Corrupt this fragment in the fuzzing tab, then come back and see whether reassembly survives it"
          onClick={() => {
            const fragment = sequence?.fragments[stepIndex];
            if (!fragment) return;
            onHandoff({
              label: `Fragment ${stepIndex + 1} of ${sequence!.fragments.length}`,
              origin: 'fragmentation',
              stack: fragment.stack,
            });
          }}
          className="flex cursor-pointer items-center gap-1 rounded-md border border-zinc-700 px-2 py-1.5 text-[12px] text-zinc-300 hover:border-cyan-600 hover:text-cyan-300 disabled:cursor-not-allowed disabled:text-zinc-600"
        >
          <Bug className="size-3.5" aria-hidden />
          <span className="hidden sm:inline">Fuzz this fragment</span>
          <span className="sm:hidden">Fuzz</span>
        </button>
      </header>

      <section aria-labelledby="mutation-heading" className="border-b border-zinc-800 px-4 py-3 sm:px-6">
        <h2 id="mutation-heading" className="text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">Delivery experiment</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5" role="radiogroup" aria-label="Fragment delivery mode">
          {FRAGMENT_MUTATIONS.map((item) => (
            <label key={item} className={`cursor-pointer rounded-lg border p-2.5 ${item === mode ? 'border-cyan-600 bg-cyan-500/10' : 'border-zinc-800 hover:border-zinc-700'}`}>
              <span className="flex items-center gap-2 text-[12px] font-medium text-zinc-200">
                <input type="radio" name="fragment-mode" value={item} checked={item === mode} onChange={() => setMode(item)} className="accent-cyan-600" />
                {MODE_COPY[item].label}
              </span>
              <span className="mt-1 block text-[11px] leading-relaxed text-zinc-500">{MODE_COPY[item].description}</span>
            </label>
          ))}
        </div>
      </section>

      {!result?.ok ? (
        <FragmentError issues={result?.issues ?? []} />
      ) : sequence && (
        <>
          <section
            aria-label="Fragment arrival timeline"
            onKeyDown={onTimelineKeyDown}
            className="border-b border-zinc-800 bg-zinc-900/30 px-4 py-3 sm:px-6"
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1" role="group" aria-label="Fragment playback controls">
                <Control label="Previous fragment" disabled={stepIndex <= 0} onClick={() => dispatch({ type: 'prev' })}><SkipBack /></Control>
                <Control label={playback.playing ? 'Pause' : 'Play'} onClick={() => dispatch({ type: 'toggle' })} primary>{playback.playing ? <Pause /> : <Play />}</Control>
                <Control label="Next fragment" disabled={stepIndex >= count - 1} onClick={() => dispatch({ type: 'next' })}><SkipForward /></Control>
              </div>
              <span role="status" aria-live="polite" className="font-mono text-[12px] text-zinc-500">
                Arrival {stepIndex + 1} of {count} · {state?.status ?? 'incomplete'}
              </span>
              <span className="text-[11px] text-zinc-600">Use left/right arrow keys to step.</span>
            </div>

            <ol className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {sequence.fragments.map((item, index) => {
                const arrivalState = reassembly[index]!;
                const active = index === stepIndex;
                const end = item.offsetBytes + item.payloadLength - 1;
                return (
                  <li key={`${item.originalIndex}-${index}`} className="shrink-0">
                    <button
                      ref={(element) => { stepRefs.current[index] = element; }}
                      aria-current={active ? 'step' : undefined}
                      aria-label={`Arrival ${index + 1}, original fragment ${item.originalIndex + 1}, bytes ${item.offsetBytes} through ${end}, ${arrivalState.status}`}
                      onClick={() => dispatch({ type: 'select', index })}
                      className={`w-48 cursor-pointer rounded-lg border p-3 text-left transition-colors ${active ? 'border-cyan-500 bg-cyan-500/10 ring-1 ring-cyan-500/30' : 'border-zinc-800 bg-zinc-950/50 hover:border-zinc-600'}`}
                    >
                      <span className="flex items-center justify-between text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">
                        <span>Arrival #{index + 1}</span><StatusBadge status={arrivalState.status} />
                      </span>
                      <span className="mt-1.5 block text-[12px] font-medium text-zinc-200">Original index #{item.originalIndex + 1}</span>
                      <span className="mt-1 block font-mono text-[11px] text-cyan-300">bytes {item.offsetBytes}–{end}</span>
                      <span className="mt-1 block font-mono text-[10px] text-zinc-500">offset {item.offsetBytes / 8} units · {item.payloadLength} B · {sequence.version === 4 ? 'MF' : 'M'}={item.moreFragments ? 1 : 0}</span>
                      <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-zinc-800" aria-hidden>
                        <span className="block h-full bg-cyan-500" style={{ marginLeft: `${(item.offsetBytes / sequence.originalPayload.length) * 100}%`, width: `${Math.max(2, (item.payloadLength / sequence.originalPayload.length) * 100)}%` }} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>

            <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
              <div aria-live="polite" className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-[12px] text-zinc-400">
                <span className="font-medium text-zinc-200">Progressive diagnosis: </span>
                {state?.issues.at(-1)?.message ?? (state?.complete ? 'All byte ranges are present and unambiguous.' : 'Waiting for enough contiguous byte ranges and a final fragment.')}
              </div>
              <div className={`rounded-lg border px-3 py-2 text-[12px] ${finalState?.status === 'complete' && exactMatch ? 'border-emerald-700/60 bg-emerald-500/10 text-emerald-300' : finalState?.status === 'ambiguous' ? 'border-rose-700/60 bg-rose-500/10 text-rose-300' : 'border-amber-700/60 bg-amber-500/10 text-amber-300'}`}>
                <span className="font-semibold">Final result: </span>{finalResultCopy(finalState?.status, exactMatch)}
              </div>
            </div>
          </section>

          <Education version={sequence.version} identification={sequence.identification} />

          {sequence.issues.length > 0 && <IssueList issues={sequence.issues} />}
          <ValidationPanel validation={step?.validation ?? []} serializeIssues={step?.packet?.issues ?? []} packet={step?.packet} />

          <ResizablePanes
            storagePrefix="pv-fragmentation-pane"
            left={{
              title: 'Fragment fields',
              children: step && <FieldEditor layers={step.stack.layers} packet={step.packet} registry={registry} readOnly />,
            }}
            center={{
              title: 'Packet diagrams',
              children: step?.packet ? <PacketDiagrams packet={step.packet} registry={registry} /> : <EmptyPane />,
            }}
            right={{
              title: 'Hex dump',
              scrollFocusable: true,
              children: step?.packet && <HexView packet={step.packet} registry={registry} validation={step.validation} inspectionMode={inspectionMode} onInspectionModeChange={setInspectionMode} />,
            }}
          />
        </>
      )}
    </>
  );
}

function Education({ version, identification }: { version: 4 | 6; identification: number }) {
  return (
    <section aria-labelledby="fragment-guide-heading" className="grid gap-2 border-b border-zinc-800 px-4 py-3 sm:grid-cols-2 sm:px-6 lg:grid-cols-5">
      <h2 id="fragment-guide-heading" className="sr-only">How fragmentation works</h2>
      <Lesson title="Identification">{version === 4 ? 'IPv4 copies the datagram Identification field' : 'IPv6 adds a Fragment header with a deterministic lab ID'}: <code className="text-cyan-300">0x{identification.toString(16).padStart(version === 4 ? 4 : 8, '0')}</code>. It groups arrivals belonging to one datagram.</Lesson>
      <Lesson title="Flags">{version === 4 ? 'IPv4 clears DF, then MF' : 'IPv6 M'}=1 says more fragments follow. The final fragment clears the more-fragments flag, revealing the datagram’s endpoint.</Lesson>
      <Lesson title="Offset">The encoded offset counts 8-byte units, not bytes. Multiply it by eight to place each payload range.</Lesson>
      <Lesson title="Alignment">Every non-final payload must be a multiple of eight bytes. The final fragment may contain the remainder.</Lesson>
      <Lesson title="Diagnosis">Gaps stay incomplete; exact duplicates are ignored; ordering alone is harmless; overlaps are ambiguous and unsafe.</Lesson>
    </section>
  );
}

function Lesson({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3"><h3 className="text-[11px] font-semibold text-zinc-200">{title}</h3><p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{children}</p></div>;
}

function StatusBadge({ status }: { status: 'incomplete' | 'complete' | 'ambiguous' | 'rejected' }) {
  const color = status === 'complete' ? 'text-emerald-400' : status === 'ambiguous' || status === 'rejected' ? 'text-rose-400' : 'text-amber-400';
  return <span className={color}>{status}</span>;
}

function Control({ label, disabled, primary, onClick, children }: { label: string; disabled?: boolean; primary?: boolean; onClick: () => void; children: React.ReactElement<{ className?: string }> }) {
  return <button aria-label={label} title={label} disabled={disabled} onClick={onClick} className={`cursor-pointer rounded-md border p-1.5 disabled:cursor-not-allowed disabled:text-zinc-600 ${primary ? 'border-cyan-700 bg-cyan-700/20 text-cyan-200' : 'border-zinc-700 text-zinc-300 hover:border-cyan-600'}`}>{children}</button>;
}

function FragmentError({ issues }: { issues: FragmentIssue[] }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center" role="alert">
      <h2 className="text-sm font-semibold text-zinc-200">This datagram cannot be fragmented yet</h2>
      {issues.map((item) => <p key={item.code} className="max-w-xl text-[13px] text-amber-400">{item.message}</p>)}
      <p className="max-w-xl text-[12px] text-zinc-500">Try a smaller MTU if the packet already fits, or correct the packet and its IP layout in Builder.</p>
      <Link to="/builder" className="mt-2 rounded-md border border-cyan-700 px-3 py-1.5 text-[12px] text-cyan-300 hover:bg-cyan-500/10">Open Stack Builder</Link>
    </div>
  );
}

function IssueList({ issues }: { issues: FragmentIssue[] }) {
  return <div role="status" aria-live="polite" className="flex flex-col gap-1 px-4 py-2 sm:px-6">{issues.map((item) => <p key={`${item.code}-${item.message}`} className={`text-[12px] ${item.severity === 'error' ? 'text-rose-400' : item.severity === 'warning' ? 'text-amber-400' : 'text-sky-400'}`}>{item.message}</p>)}</div>;
}

function Unavailable({ title, detail }: { title: string; detail: string }) {
  return <div className="flex h-full flex-col"><header className="border-b border-zinc-800 px-6 py-3"><h1 className="text-[15px] font-semibold text-zinc-100">Fragmentation Lab</h1></header><div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center"><h2 className="text-sm font-semibold text-zinc-200">{title}</h2><p className="max-w-md text-[13px] text-zinc-500">{detail}</p><Link to="/builder" className="mt-2 rounded-md bg-cyan-700 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-cyan-600">Open Stack Builder</Link></div></div>;
}

function EmptyPane() {
  return <div className="p-6 text-[13px] text-zinc-600">No fragment packet to inspect.</div>;
}

function stableIdentification(uid: string, payload: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (const value of new TextEncoder().encode(uid)) hash = Math.imul(hash ^ value, 0x01000193);
  for (const value of payload) hash = Math.imul(hash ^ value, 0x01000193);
  return hash >>> 0;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function finalResultCopy(status: string | undefined, exactMatch: boolean): string {
  if (status === 'complete') return exactMatch ? 'complete; reassembled bytes exactly match the original.' : 'complete, but bytes do not match the original.';
  if (status === 'ambiguous') return 'ambiguous; overlapping bytes prevent one safe answer.';
  if (status === 'rejected') return 'rejected as malformed.';
  return 'incomplete; the original byte stream cannot yet be recovered.';
}
