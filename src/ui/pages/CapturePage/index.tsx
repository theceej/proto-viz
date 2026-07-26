import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FolderOpen, Info, MessageSquareText, X } from 'lucide-react';
import { useLibraryStore } from '../../../store/libraryStore';
import { useCaptureStore } from '../../../store/captureStore';
import { UnsupportedLinkTypeError } from '../../../core/capture';
import { CaptureReadError, DEFAULT_LIMITS } from '../../../core/captureFile';
import { parseCaptureAsync } from '../../../core/captureWorkerClient';
import { filterPackets, type CaptureFilter } from '../../../core/captureFilter';
import { groupFlows, packetsInFlow } from '../../../core/flows';
import { useInspectionMode } from '../../inspectionMode';
import HexView from '../../components/HexView';
import FieldEditor from '../../components/FieldEditor';
import PacketDiagrams from '../../components/PacketDiagrams';
import ResizablePanes from '../../components/ResizablePanes';
import AddToCompareButton from '../../components/AddToCompareButton';
import FilterBar from './FilterBar';
import PacketList, { comparePackets, type Sort } from './PacketList';
import FlowList from './FlowList';
import CaptureTimeline from './CaptureTimeline';
import { formatByteCount } from './format';

type Tab = 'packets' | 'flows';

/**
 * The capture viewer: open a classic pcap or pcapng file, decode every packet
 * off the main thread via a Web Worker (with synchronous fallback), and inspect
 * any packet in the field / diagram / hex panes.
 */
export default function CapturePage() {
  const registry = useLibraryStore((s) => s.registry);
  const capture = useCaptureStore((s) => s.capture);
  const selected = useCaptureStore((s) => s.selected);
  const filter = useCaptureStore((s) => s.filter);
  const flowKey = useCaptureStore((s) => s.flowKey);
  const setCapture = useCaptureStore((s) => s.setCapture);
  const select = useCaptureStore((s) => s.select);
  const setFilter = useCaptureStore((s) => s.setFilter);
  const setFlowKey = useCaptureStore((s) => s.setFlowKey);
  const close = useCaptureStore((s) => s.close);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
  const [tab, setTab] = useState<Tab>('packets');
  const [sort, setSort] = useState<Sort>({ key: 'number', ascending: true });
  const [inspectionMode, setInspectionMode] = useInspectionMode();
  const inputRef = useRef<HTMLInputElement>(null);
  const profileRequested = useRef(new URLSearchParams(location.search).has('captureProfile'));

  useEffect(() => {
    if (!capture || !profileRequested.current) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        performance.mark('capture-profile:first-useful-render');
        window.dispatchEvent(new CustomEvent('capture-profile:render', {
          detail: Object.fromEntries(
            performance
              .getEntriesByType('mark')
              .filter((entry) => entry.name.startsWith('capture-profile:'))
              .map((entry) => [entry.name, entry.startTime]),
          ),
        }));
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [capture]);

  const openFile = async (file: File) => {
    if (profileRequested.current) {
      performance.clearMarks();
      performance.mark('capture-profile:start');
    }
    setError(null);
    setLoading(true);
    setProgress(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsedCapture = await parseCaptureAsync({
        data: bytes,
        registry,
        fileName: file.name,
        onProgress: (processed, total) => setProgress({ processed, total }),
        ...(profileRequested.current
          ? {
              onProfile: (profile: import('../../../core/captureWorkerClient').CaptureAsyncProfile) => {
                performance.mark('capture-profile:response-received');
                window.dispatchEvent(new CustomEvent('capture-profile:worker', { detail: profile }));
              },
            }
          : {}),
      });
      setCapture(parsedCapture);
      if (profileRequested.current) performance.mark('capture-profile:state-updated');
      setTab('packets');
      setSort({ key: 'number', ascending: true });
    } catch (e) {
      if (e instanceof CaptureReadError || e instanceof UnsupportedLinkTypeError) {
        setError(e.message);
      } else {
        setError(`The capture could not be read: ${(e as Error).message}`);
      }
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const packets = useMemo(() => capture?.packets ?? [], [capture]);

  // Flows are grouped from the filtered set so the conversation list answers
  // "what is in what I am looking at", not "what was in the file".
  const matched = useMemo(() => filterPackets(packets, filter), [packets, filter]);
  const flows = useMemo(() => groupFlows(matched), [matched]);
  const activeFlow = flows.find((flow) => flow.key === flowKey) ?? null;

  const listed = useMemo(() => {
    const rows = activeFlow ? packetsInFlow(matched, activeFlow) : matched;
    return [...rows].sort((a, b) => comparePackets(a, b, sort));
  }, [matched, activeFlow, sort]);

  const current = packets.find((packet) => packet.number === selected) ?? null;

  const changeFilter = (next: CaptureFilter) => {
    setFilter(next);
    // A flow selected under the old filter may no longer exist under the new
    // one; dropping it avoids an empty list with no visible cause.
    setFlowKey(null);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-6 py-3">
        <h1 className="text-[15px] font-semibold tracking-tight text-zinc-100">Capture Viewer</h1>
        <button
          className="flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1 text-[12px] text-zinc-300 hover:border-cyan-600 hover:text-cyan-300"
          onClick={() => inputRef.current?.click()}
        >
          <FolderOpen className="size-3.5" aria-hidden />
          Open capture
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".pcap,.pcapng,.ntar,.cap,.dmp,application/vnd.tcpdump.pcap"
          className="hidden"
          aria-label="Open a capture file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset so re-picking the same file fires another change event.
            e.target.value = '';
            if (file) void openFile(file);
          }}
        />
        {loading && (
          <span className="flex items-center gap-2 rounded-md border border-cyan-800/60 bg-cyan-950/40 px-2.5 py-1 text-[12px] text-cyan-300">
            <span className="size-3 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
            <span>
              Parsing capture...
              {progress && progress.total > 0
                ? ` (${Math.round((progress.processed / progress.total) * 100)}%)`
                : ''}
            </span>
          </span>
        )}
        {capture && (
          <>
            <span className="flex items-center gap-2 text-[12px] text-zinc-400">
              <span className="font-medium text-zinc-200">{capture.fileName}</span>
              <span className="font-mono text-zinc-500">
                {capture.packets.length} packets ·{' '}
                {capture.format === 'pcapng' ? 'pcapng' : 'classic pcap'} ·{' '}
                {capture.linkTypeLabel} ·{' '}
                {capture.timestampPrecision === 'nanosecond' ? 'ns' : 'µs'} ·{' '}
                {capture.byteOrder}-endian
              </span>
            </span>
            <button
              className="cursor-pointer rounded-md border border-zinc-700 p-1 text-zinc-400 hover:border-rose-600 hover:text-rose-300"
              aria-label="Close capture"
              onClick={close}
            >
              <X className="size-3.5" />
            </button>
          </>
        )}
        <div className="ml-auto">
          <AddToCompareButton
            packet={current?.packet ?? null}
            label={`${capture?.fileName ?? 'Capture'} · #${current?.number ?? 0} ${current?.topProtocol ?? ''}`}
            labelClass="hidden sm:inline"
          />
        </div>
      </header>

      {error && (
        <p
          role="alert"
          className="flex items-start gap-1.5 border-b border-rose-900/60 bg-rose-950/30 px-6 py-2 text-[12px] text-rose-300"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {!capture ? (
        <EmptyState
          onBrowse={() => inputRef.current?.click()}
          onFile={(f) => void openFile(f)}
          loading={loading}
          progress={progress}
        />
      ) : (
        <>
          {capture.notes.length > 0 && (
            <ul className="border-b border-zinc-800 bg-zinc-900/40 px-6 py-2 text-[11px] text-zinc-400">
              {capture.notes.map((note) => (
                <li key={note} className="flex items-start gap-1.5">
                  <Info className="mt-0.5 size-3 shrink-0 text-zinc-500" aria-hidden />
                  {note}
                </li>
              ))}
            </ul>
          )}

          <FilterBar
            packets={packets}
            filter={filter}
            onChange={changeFilter}
            matched={matched.length}
          />

          <CaptureTimeline packets={listed} selected={selected} onSelect={select} />

          <div className="flex items-center gap-1 border-b border-zinc-800 px-6">
            <TabButton active={tab === 'packets'} onClick={() => setTab('packets')}>
              Packets ({listed.length})
            </TabButton>
            <TabButton active={tab === 'flows'} onClick={() => setTab('flows')}>
              Flows ({flows.length})
            </TabButton>
            {activeFlow && (
              <button
                className="ml-2 flex cursor-pointer items-center gap-1 rounded-md border border-cyan-700 bg-cyan-700/15 px-2 py-0.5 text-[11px] text-cyan-200 hover:bg-cyan-700/25"
                onClick={() => setFlowKey(null)}
              >
                <X className="size-3" aria-hidden />
                Showing one flow
              </button>
            )}
            <span className="ml-auto py-2 font-mono text-[11px] text-zinc-600">
              {formatByteCount(listed.reduce((sum, p) => sum + p.capturedLength, 0))} shown
            </span>
          </div>

          <div className="flex h-64 shrink-0 flex-col border-b border-zinc-800">
            {tab === 'packets' ? (
              <PacketList
                packets={listed}
                selected={selected}
                onSelect={select}
                sort={sort}
                onSortChange={setSort}
              />
            ) : (
              <FlowList
                flows={flows}
                activeKey={flowKey}
                onSelect={(flow) => {
                  setFlowKey(flow.key);
                  setTab('packets');
                  const first = flow.packetNumbers[0];
                  if (first !== undefined) select(first);
                }}
              />
            )}
          </div>

          {current?.comment !== undefined && (
            <p className="border-b border-zinc-800 px-6 py-1.5 text-[11px] text-zinc-300">
              <MessageSquareText
                className="mr-1.5 inline size-3 align-[-1px] text-zinc-500"
                aria-hidden
              />
              <span className="sr-only">Packet comment: </span>
              {current.comment}
            </p>
          )}

          {current && current.notes.length > 0 && (
            <p className="border-b border-zinc-800 px-6 py-1.5 text-[11px] text-amber-300/90">
              Packet {current.number}: {current.notes.join(' · ')}
            </p>
          )}

          <ResizablePanes
            storagePrefix="pv-capture-pane"
            left={{
              title: 'Field editor',
              children: current && (
                <FieldEditor
                  layers={current.stack.layers}
                  packet={current.packet}
                  registry={registry}
                  readOnly
                />
              ),
            }}
            center={{
              title: 'Packet diagrams',
              children: current?.packet ? (
                <PacketDiagrams packet={current.packet} registry={registry} />
              ) : (
                <div className="p-6 text-[13px] text-zinc-600">
                  {current
                    ? 'This packet could not be decoded — its bytes are in the hex pane.'
                    : 'Select a packet to inspect it.'}
                </div>
              ),
            }}
            right={{
              title: 'Hex dump',
              scrollFocusable: true,
              children: current?.packet ? (
                <HexView
                  packet={current.packet}
                  registry={registry}
                  validation={[]}
                  inspectionMode={inspectionMode}
                  onInspectionModeChange={setInspectionMode}
                />
              ) : (
                current && <RawBytes bytes={current.bytes} />
              ),
            }}
          />
        </>
      )}
    </div>
  );
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
      aria-pressed={active}
      onClick={onClick}
      className={`cursor-pointer border-b-2 px-3 py-2 text-[12px] font-medium transition-colors ${
        active
          ? 'border-cyan-500 text-cyan-300'
          : 'border-transparent text-zinc-400 hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  );
}

/** Plain hex for a packet no layer could be read from. */
function RawBytes({ bytes }: { bytes: Uint8Array }) {
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const row = [...bytes.slice(offset, offset + 16)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
    lines.push(`${offset.toString(16).padStart(4, '0')}  ${row}`);
  }
  return (
    <pre className="p-4 font-mono text-[11px] leading-5 text-zinc-400">{lines.join('\n')}</pre>
  );
}

function EmptyState({
  onBrowse,
  onFile,
  loading = false,
  progress = null,
}: {
  onBrowse: () => void;
  onFile: (file: File) => void;
  loading?: boolean;
  progress?: { processed: number; total: number } | null;
}) {
  const [dragging, setDragging] = useState(false);

  if (loading) {
    const percent =
      progress && progress.total > 0
        ? Math.round((progress.processed / progress.total) * 100)
        : null;

    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="flex h-56 w-full max-w-xl flex-col items-center justify-center gap-3 rounded-xl border border-cyan-800/60 bg-cyan-950/20 p-6 text-center">
          <div className="size-6 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
          <p className="text-[13px] font-medium text-cyan-200">
            Parsing and decoding capture file...
          </p>
          <p className="font-mono text-[12px] text-cyan-400/80">
            {percent !== null
              ? `${percent}% (${progress!.processed} of ${progress!.total} packets)`
              : 'Reading records off main thread...'}
          </p>
          {percent !== null && (
            <div className="h-1.5 w-48 overflow-hidden rounded-full border border-cyan-800/60 bg-cyan-950">
              <div
                className="h-full bg-cyan-400 transition-all duration-150"
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div
        role="button"
        tabIndex={0}
        aria-label="Open a capture file"
        className={`flex h-56 w-full max-w-xl cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed transition-colors focus-visible:border-cyan-500 focus-visible:outline-2 focus-visible:outline-cyan-400 ${
          dragging ? 'border-cyan-500 bg-cyan-500/5' : 'border-zinc-700 hover:border-zinc-500'
        }`}
        onClick={onBrowse}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onBrowse();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) onFile(file);
        }}
      >
        <FolderOpen className="size-6 text-zinc-500" aria-hidden />
        <p className="text-[13px] text-zinc-400">
          Drop a .pcap or .pcapng here, or click to browse
        </p>
        <p className="max-w-sm text-center text-[11px] leading-relaxed text-zinc-600">
          Classic pcap and pcapng, either byte order, microsecond or nanosecond
          timestamps. Ethernet, raw IP, IPv4, and IPv6 link types. Up to{' '}
          {DEFAULT_LIMITS.maxFileBytes / (1024 * 1024)} MB and{' '}
          {DEFAULT_LIMITS.maxPackets.toLocaleString()} packets. Parsed entirely in
          your browser — nothing is uploaded.
        </p>
      </div>
    </div>
  );
}
