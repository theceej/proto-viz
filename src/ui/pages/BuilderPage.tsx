import {
  ChevronDown,
  ChevronsLeftRight,
  ChevronsRightLeft,
  ClipboardPaste,
  Dices,
  Download,
  ImageDown,
  Redo2,
  Share2,
  Undo2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStackStore } from '../../store/stackStore';
import { randomStack } from '../../core/random';
import { decodeShare } from '../../core/share';
import { decodePacketBlob } from '../../core/shareBlob';
import { usePacket } from '../usePacket';
import { useEscape } from '../a11y';
import { usePersistedFlag } from '../usePersistedFlag';
import SavedStacks from '../components/SavedStacks';
import StackStrip from '../components/StackStrip';
import ValidationPanel from '../components/ValidationPanel';
import BitGrid from '../components/BitGrid';
import HexView from '../components/HexView';
import FieldEditor from '../components/FieldEditor';
import ExportDialog from '../components/ExportDialog';
import ShareDialog from '../components/ShareDialog';
import DecodeDialog from '../components/DecodeDialog';
import DiagramExportDialog from '../components/DiagramExportDialog';
import ProtocolInfoLink from '../components/ProtocolInfoLink';
import { layerColor, PAYLOAD_COLOR } from '../colors';
import { bitsLabel } from '../format';
import { useInspectionMode } from '../inspectionMode';

const PRESETS: { name: string; ids: string[]; payload?: string }[] = [
  { name: 'TCP over Ethernet', ids: ['ethernet', 'ipv4', 'tcp'] },
  { name: 'HTTP request', ids: ['ethernet', 'ipv4', 'tcp', 'http1'] },
  { name: 'DNS query', ids: ['ethernet', 'ipv4', 'udp', 'dns'] },
  { name: 'ICMP ping', ids: ['ethernet', 'ipv4', 'icmp'], payload: 'abcdefgh' },
  { name: 'IPv6 ping', ids: ['ethernet', 'ipv6', 'icmpv6'], payload: 'abcdefgh' },
  { name: 'DHCP discover', ids: ['ethernet', 'ipv4', 'udp', 'dhcp'] },
  { name: 'VLAN-tagged TCP', ids: ['ethernet', 'vlan-8021q', 'ipv4', 'tcp'] },
  { name: 'Q-in-Q', ids: ['ethernet', 'vlan-8021q', 'vlan-8021q', 'ipv4', 'udp'] },
  {
    name: 'VXLAN overlay',
    ids: ['ethernet', 'ipv4', 'udp', 'vxlan', 'ethernet', 'ipv4', 'udp'],
    payload: 'inner payload',
  },
  { name: 'GRE tunnel (IP-in-IP)', ids: ['ethernet', 'ipv4', 'gre', 'ipv4', 'icmp'] },
  { name: 'MPLS label stack', ids: ['ethernet', 'mpls', 'ipv4', 'udp'] },
  { name: 'HTTPS (TLS record)', ids: ['ethernet', 'ipv4', 'tcp', 'tls', 'http1'] },
  { name: 'BGP keepalive', ids: ['ethernet', 'ipv4', 'tcp', 'bgp'] },
  { name: 'PPPoE session', ids: ['ethernet', 'pppoe', 'ipv4', 'udp'] },
  { name: 'Spanning tree BPDU', ids: ['ethernet-8023', 'stp'] },
  { name: 'VoIP audio (RTP)', ids: ['ethernet', 'ipv4', 'udp', 'rtp'], payload: 'samples…' },
  { name: 'WireGuard handshake', ids: ['ethernet', 'ipv4', 'udp', 'wireguard'] },
  { name: 'Mobile data (GTP-U)', ids: ['ethernet', 'ipv4', 'udp', 'gtpu', 'ipv4', 'tcp'] },
  { name: 'IPsec AH transport', ids: ['ethernet', 'ipv4', 'ipsec-ah', 'tcp'] },
];

export default function BuilderPage() {
  const { stack, registry, packet, serializeError, validation } = usePacket();
  const [exporting, setExporting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [exportingDiagram, setExportingDiagram] = useState(false);
  const replaceLayers = useStackStore((s) => s.replaceLayers);
  const restoreStack = useStackStore((s) => s.restoreStack);
  const setStack = useStackStore((s) => s.setStack);
  const undo = useStackStore((s) => s.undo);
  const redo = useStackStore((s) => s.redo);
  const canUndo = useStackStore((s) => s.canUndo);
  const canRedo = useStackStore((s) => s.canRedo);
  const [searchParams, setSearchParams] = useSearchParams();
  const [inspectionMode, setInspectionMode] = useInspectionMode();

  // Opening a shared link (#/builder?s=word.word.word[&e=<edits>]) loads that
  // stack once. The optional `e` blob carries field edits and payload; without
  // it, only the layer structure loads. A bad code stays in the URL and
  // renders as an error banner until dismissed.
  const shareParam = searchParams.get('s');
  const editsParam = searchParams.get('e');
  const shareLoad = useMemo(() => {
    if (shareParam === null) return null;
    try {
      const ids = decodeShare(shareParam);
      if (editsParam) return decodePacketBlob(editsParam, ids, registry);
      return { ids };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [shareParam, editsParam, registry]);
  useEffect(() => {
    if (!shareLoad || 'error' in shareLoad) return;
    if ('layers' in shareLoad) restoreStack(shareLoad.layers, shareLoad.payload);
    else setStack(shareLoad.ids);
    setSearchParams({}, { replace: true });
  }, [shareLoad, setStack, restoreStack, setSearchParams]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [redo, undo]);

  const rollRandomStack = () => {
    const random = randomStack(registry);
    replaceLayers(random.layers, random.trailingPayload);
  };

  const [fieldsCollapsed, setFieldsCollapsed] = usePersistedFlag('pv-pane-fields', false);
  const [diagramsCollapsed, setDiagramsCollapsed] = usePersistedFlag(
    'pv-pane-diagrams',
    false,
  );
  const [hexCollapsed, setHexCollapsed] = usePersistedFlag('pv-pane-hex', false);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-800 px-6 py-3">
        <h1 className="text-[15px] font-semibold tracking-tight text-zinc-100">
          Stack Builder
        </h1>
        <PresetsMenu />
        <SavedStacks stack={stack} registry={registry} />
        <div className="flex items-center gap-1" role="group" aria-label="Edit history">
          <button
            className="cursor-pointer rounded-md border border-zinc-700 p-1.5 text-zinc-300 hover:border-cyan-600 hover:text-cyan-300 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600"
            title="Undo (Ctrl/⌘+Z)"
            aria-label="Undo"
            disabled={!canUndo}
            onClick={undo}
          >
            <Undo2 className="size-3.5" />
          </button>
          <button
            className="cursor-pointer rounded-md border border-zinc-700 p-1.5 text-zinc-300 hover:border-cyan-600 hover:text-cyan-300 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600"
            title="Redo (Ctrl/⌘+Shift+Z)"
            aria-label="Redo"
            disabled={!canRedo}
            onClick={redo}
          >
            <Redo2 className="size-3.5" />
          </button>
        </div>
        <button
          className="flex cursor-pointer items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1 text-[12px] text-zinc-300 hover:border-cyan-600 hover:text-cyan-300 disabled:cursor-not-allowed disabled:text-zinc-600"
          title="Export packet diagram as SVG or PNG"
          disabled={!packet}
          onClick={() => setExportingDiagram(true)}
        >
          <ImageDown className="size-3.5" />
          Diagram
        </button>
        <button
          className="flex cursor-pointer items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1 text-[12px] text-zinc-300 hover:border-fuchsia-500 hover:text-fuchsia-300"
          title="Generate a random valid stack"
          onClick={rollRandomStack}
        >
          <Dices className="size-3.5" />
          Random
        </button>
        <button
          className="flex cursor-pointer items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1 text-[12px] text-zinc-300 hover:border-cyan-600 hover:text-cyan-300"
          title="Share this stack as a word code"
          onClick={() => setSharing(true)}
        >
          <Share2 className="size-3.5" />
          Share
        </button>
        <button
          className="flex cursor-pointer items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1 text-[12px] text-zinc-300 hover:border-cyan-600 hover:text-cyan-300"
          title="Paste packet hex and decode it into a stack"
          onClick={() => setDecoding(true)}
        >
          <ClipboardPaste className="size-3.5" />
          Decode
        </button>
        <div className="ml-auto flex items-center gap-3">
          {packet && (
            <span className="font-mono text-[12px] text-zinc-500">
              {packet.bytes.length} bytes · {packet.payloadOffset} bytes headers
            </span>
          )}
          <button
            className="flex cursor-pointer items-center gap-1.5 rounded-md bg-cyan-700 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-cyan-600 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
            disabled={stack.layers.length === 0}
            onClick={() => setExporting(true)}
          >
            <Download className="size-3.5" />
            Export PCAP
          </button>
        </div>
      </header>

      {exporting && (
        <ExportDialog
          stack={stack}
          registry={registry}
          validation={validation}
          onClose={() => setExporting(false)}
        />
      )}
      {sharing && (
        <ShareDialog stack={stack} registry={registry} onClose={() => setSharing(false)} />
      )}
      {decoding && (
        <DecodeDialog registry={registry} onClose={() => setDecoding(false)} />
      )}
      {exportingDiagram && packet && (
        <DiagramExportDialog packet={packet} registry={registry} onClose={() => setExportingDiagram(false)} />
      )}

      {shareLoad && 'error' in shareLoad && (
        <div
          role="alert"
          className="flex items-center gap-2 border-b border-zinc-800 bg-rose-500/5 px-6 py-2 text-[12px] text-rose-400"
        >
          Could not load the shared stack: {shareLoad.error}
          <button
            className="ml-auto cursor-pointer rounded p-1 text-zinc-500 hover:text-zinc-200"
            aria-label="Dismiss shared-stack error"
            onClick={() => setSearchParams({}, { replace: true })}
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <StackStrip layers={stack.layers} registry={registry} validation={validation} />
      <ValidationPanel validation={validation} serializeIssues={packet?.issues ?? []} />

      {serializeError && (
        <div className="px-6 pb-2 text-[12px] text-rose-400">
          Serialization failed: {serializeError}
        </div>
      )}

      <div className="flex min-h-0 flex-1 border-t border-zinc-800">
        <Pane
          title="Field editor"
          collapsed={fieldsCollapsed}
          onToggle={setFieldsCollapsed}
          expandedClass={diagramsCollapsed ? 'min-w-0 flex-1' : 'w-[26rem] shrink-0'}
          className="border-r border-zinc-800"
        >
          <FieldEditor layers={stack.layers} packet={packet} registry={registry} />
        </Pane>
        <Pane
          title="Packet diagrams"
          collapsed={diagramsCollapsed}
          onToggle={setDiagramsCollapsed}
          expandedClass="min-w-0 flex-1"
        >
          {packet && packet.layers.length > 0 ? (
            <div className="flex flex-col gap-5 p-5">
              {packet.layers.map((layout, i) => {
                const def = registry.get(layout.protocolId);
                if (!def) return null;
                const spans = packet.spans.filter((s) => s.layerUid === layout.uid);
                const color = layerColor(i);
                return (
                  <div key={layout.uid}>
                    <div className="mb-1 flex items-baseline gap-2">
                      <span
                        className="size-2 self-center rounded-full"
                        style={{ background: color.accent }}
                      />
                      <span className="text-[13px] font-semibold text-zinc-100">
                        {def.name}
                      </span>
                      <ProtocolInfoLink protocolId={def.id} name={def.name} />
                      <span className="font-mono text-[11px] text-zinc-500">
                        {bitsLabel(layout.headerBytes * 8)} · offset {layout.byteOffset}
                      </span>
                    </div>
                    <BitGrid def={def} layout={layout} spans={spans} color={color} />
                  </div>
                );
              })}
              {packet.bytes.length > packet.payloadOffset && (
                <div>
                  <div className="mb-1 flex items-baseline gap-2">
                    <span
                      className="size-2 self-center rounded-full"
                      style={{ background: PAYLOAD_COLOR.accent }}
                    />
                    <span className="text-[13px] font-semibold text-zinc-100">Payload</span>
                    <span className="font-mono text-[11px] text-zinc-500">
                      {packet.bytes.length - packet.payloadOffset} bytes
                    </span>
                  </div>
                  <div
                    className="rounded-md px-3 py-2 text-[12px] text-zinc-400 italic"
                    style={{
                      background: PAYLOAD_COLOR.fill,
                      boxShadow: `inset 0 0 0 1px ${PAYLOAD_COLOR.border}`,
                    }}
                  >
                    opaque payload — edit under “Payload” on the left
                  </div>
                </div>
              )}
            </div>
          ) : (
            <EmptyState />
          )}
        </Pane>
        <Pane
          title="Hex dump"
          collapsed={hexCollapsed}
          onToggle={setHexCollapsed}
          expandedClass={diagramsCollapsed ? 'min-w-0 flex-1' : 'w-[27rem] shrink-0'}
          className="border-l border-zinc-800"
          scrollFocusable
        >
          {packet && <HexView packet={packet} registry={registry} validation={validation} inspectionMode={inspectionMode} onInspectionModeChange={setInspectionMode} />}
        </Pane>
      </div>
    </div>
  );
}

/**
 * Builder pane that collapses to a slim vertical strip. Collapse state
 * persists per pane; hiding the diagrams pane lets its neighbours grow.
 */
function Pane({
  title,
  collapsed,
  onToggle,
  expandedClass,
  className = '',
  scrollFocusable = false,
  children,
}: {
  title: string;
  collapsed: boolean;
  onToggle: (collapsed: boolean) => void;
  expandedClass: string;
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

function PresetsMenu() {
  const [open, setOpen] = useState(false);
  const setStack = useStackStore((s) => s.setStack);
  useEscape(open, () => setOpen(false));
  return (
    <div className="relative">
      <button
        className="flex cursor-pointer items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1 text-[12px] text-zinc-300 hover:border-zinc-500"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
      >
        Presets
        <ChevronDown className="size-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 z-20 mt-1 w-64 rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl shadow-black/50">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                className="block w-full cursor-pointer px-3 py-1.5 text-left text-[13px] text-zinc-200 hover:bg-zinc-800"
                onClick={() => {
                  setStack(
                    p.ids,
                    p.payload ? new TextEncoder().encode(p.payload) : undefined,
                  );
                  setOpen(false);
                }}
              >
                {p.name}
                <span className="block font-mono text-[10px] text-zinc-500">
                  {p.ids.join(' › ')}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <p className="text-sm text-zinc-400">Your stack is empty.</p>
      <p className="max-w-sm text-[13px] text-zinc-600">
        Add a layer with the button above, or pick a preset to get started.
      </p>
    </div>
  );
}
