import { ChevronDown, Dices, Download } from 'lucide-react';
import { useState } from 'react';
import { useStackStore } from '../../store/stackStore';
import { randomStack } from '../../core/random';
import { usePacket } from '../usePacket';
import { useEscape } from '../a11y';
import SavedStacks from '../components/SavedStacks';
import StackStrip from '../components/StackStrip';
import ValidationPanel from '../components/ValidationPanel';
import BitGrid from '../components/BitGrid';
import HexView from '../components/HexView';
import FieldEditor from '../components/FieldEditor';
import ExportDialog from '../components/ExportDialog';
import { layerColor, PAYLOAD_COLOR } from '../colors';
import { bitsLabel } from '../format';

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
];

export default function BuilderPage() {
  const { stack, registry, packet, serializeError, validation } = usePacket();
  const [exporting, setExporting] = useState(false);
  const replaceLayers = useStackStore((s) => s.replaceLayers);

  const rollRandomStack = () => {
    const random = randomStack(registry);
    replaceLayers(random.layers, random.trailingPayload);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-800 px-6 py-3">
        <h1 className="text-[15px] font-semibold tracking-tight text-zinc-100">
          Stack Builder
        </h1>
        <PresetsMenu />
        <SavedStacks stack={stack} registry={registry} />
        <button
          className="flex cursor-pointer items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1 text-[12px] text-zinc-300 hover:border-fuchsia-500 hover:text-fuchsia-300"
          title="Generate a random valid stack"
          onClick={rollRandomStack}
        >
          <Dices className="size-3.5" />
          Random
        </button>
        <div className="ml-auto flex items-center gap-3">
          {packet && (
            <span className="font-mono text-[12px] text-zinc-500">
              {packet.bytes.length} bytes
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

      <StackStrip layers={stack.layers} registry={registry} validation={validation} />
      <ValidationPanel validation={validation} serializeIssues={packet?.issues ?? []} />

      {serializeError && (
        <div className="px-6 pb-2 text-[12px] text-rose-400">
          Serialization failed: {serializeError}
        </div>
      )}

      <div className="flex min-h-0 flex-1 border-t border-zinc-800">
        <div
          className="w-[26rem] shrink-0 overflow-auto border-r border-zinc-800"
          role="region"
          aria-label="Field editor"
        >
          <FieldEditor layers={stack.layers} packet={packet} registry={registry} />
        </div>
        <div
          className="min-w-0 flex-1 overflow-auto"
          role="region"
          aria-label="Packet diagrams"
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
        </div>
        <div
          className="w-[27rem] shrink-0 overflow-auto border-l border-zinc-800"
          role="region"
          aria-label="Hex dump"
          tabIndex={0}
        >
          {packet && <HexView packet={packet} />}
        </div>
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
