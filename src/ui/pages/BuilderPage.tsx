import {
  ChevronDown,
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
import SavedStacks from '../components/SavedStacks';
import StackStrip from '../components/StackStrip';
import ValidationPanel from '../components/ValidationPanel';
import HexView from '../components/HexView';
import FieldEditor from '../components/FieldEditor';
import PacketDiagrams from '../components/PacketDiagrams';
import ResizablePanes from '../components/ResizablePanes';
import ExportDialog from '../components/ExportDialog';
import ShareDialog from '../components/ShareDialog';
import DecodeDialog from '../components/DecodeDialog';
import DiagramExportDialog from '../components/DiagramExportDialog';
import { useInspectionMode } from '../inspectionMode';
import AddToCompareButton from '../components/AddToCompareButton';

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

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-6 py-3">
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
        <AddToCompareButton packet={packet} label="Stack Builder packet" />
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

      <ResizablePanes
        storagePrefix="pv-pane"
        left={{
          title: 'Field editor',
          children: <FieldEditor layers={stack.layers} packet={packet} registry={registry} />,
        }}
        center={{
          title: 'Packet diagrams',
          children:
            packet && packet.layers.length > 0 ? (
              <PacketDiagrams packet={packet} registry={registry} />
            ) : (
              <EmptyState />
            ),
        }}
        right={{
          title: 'Hex dump',
          scrollFocusable: true,
          children: packet && (
            <HexView
              packet={packet}
              registry={registry}
              validation={validation}
              inspectionMode={inspectionMode}
              onInspectionModeChange={setInspectionMode}
            />
          ),
        }}
      />
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
