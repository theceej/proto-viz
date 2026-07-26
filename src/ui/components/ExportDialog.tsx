import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, Info, X } from 'lucide-react';
import { useEscape, useModalFocus } from '../a11y';
import type { StackInstance } from '../../core/model';
import type { Registry } from '../../core/registry';
import type { ValidationIssue } from '../../core/validate';
import { planExport } from '../../core/exporter';
import { applicableScenarios } from '../../core/scenarios';
import { serializeStack } from '../../core/serialize';
import { writePcap, type PcapPacket } from '../../core/pcap';
import { writePcapng, type PcapngPacket } from '../../core/pcapng';
import { useStackStore } from '../../store/stackStore';

type Format = 'pcap' | 'pcapng';

const FORMATS: { id: Format; name: string; extension: string; mimeType: string; note: string }[] = [
  {
    id: 'pcap',
    name: 'Classic pcap',
    extension: '.pcap',
    mimeType: 'application/vnd.tcpdump.pcap',
    note: 'Maximum compatibility — every capture tool reads it.',
  },
  {
    id: 'pcapng',
    name: 'pcapng',
    extension: '.pcapng',
    mimeType: 'application/x-pcapng',
    note: 'The modern default. Each packet carries its step name as a comment.',
  },
];

/** Swap the filename's extension when the format changes, leaving the stem. */
function withExtension(filename: string, extension: string): string {
  const stem = filename.replace(/\.(pcap|pcapng|cap|ntar)$/i, '');
  return `${stem}${extension}`;
}

export default function ExportDialog({
  stack,
  registry,
  validation,
  onClose,
  onWrapInEthernet,
}: {
  stack: StackInstance;
  registry: Registry;
  validation: ValidationIssue[];
  onClose: () => void;
  /**
   * How to wrap an unexportable stack in Ethernet. Defaults to editing the
   * builder's stack, which is right when the dialog is showing that stack —
   * and wrong for a caller exporting some other packet, so those pass their
   * own handler or omit the affordance by passing null.
   */
  onWrapInEthernet?: (() => void) | null;
}) {
  const insertLayer = useStackStore((s) => s.insertLayer);
  const wrapInEthernet =
    onWrapInEthernet === undefined ? () => insertLayer('ethernet', 0) : onWrapInEthernet;
  const [scenarioId, setScenarioId] = useState('single');
  // Classic pcap stays the default: it is what every tool reads, and pcapng
  // only pays for itself when the export has step names worth carrying.
  const [format, setFormat] = useState<Format>('pcap');
  const [filename, setFilename] = useState('proto-viz.pcap');
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEscape(true, onClose);
  useModalFocus(dialogRef);

  const plan = useMemo(() => planExport(stack, registry), [stack, registry]);
  const options = useMemo(() => applicableScenarios(stack, registry), [stack, registry]);
  const hasErrors = validation.some((v) => v.severity === 'error');

  const spec = FORMATS.find((f) => f.id === format)!;

  const download = () => {
    try {
      const scenario = options.find((s) => s.id === scenarioId) ?? options[0]!;
      const plans = scenario.generate(stack, registry);
      const baseSec = Math.floor(Date.now() / 1000);
      const packets: PcapngPacket[] = plans.map((p) => {
        const serialized = serializeStack(p.stack, registry);
        return {
          bytes: serialized.bytes,
          tsSec: baseSec + Math.floor(p.atUsec / 1_000_000),
          tsUsec: p.atUsec % 1_000_000,
          // The step name ("SYN", "DORA: Offer") only survives in pcapng;
          // the classic writer has nowhere to put it.
          comment: p.label,
        };
      });
      const file =
        format === 'pcapng'
          ? writePcapng(packets, plan.linkType!)
          : writePcap(packets as PcapPacket[], plan.linkType!);
      const url = URL.createObjectURL(
        new Blob([file.buffer as ArrayBuffer], { type: spec.mimeType }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = withExtension(filename, spec.extension);
      a.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        className="flex max-h-[calc(100dvh-2rem)] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center border-b border-zinc-800 px-5 py-3">
          <h2 id="export-dialog-title" className="text-[14px] font-semibold text-zinc-100">
            Export PCAP
          </h2>
          <button
            className="ml-auto cursor-pointer rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Close export dialog"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-4">
          {plan.ok ? (
            <div className="flex items-start gap-2 text-[12px] text-zinc-400">
              <Info className="mt-0.5 size-3.5 shrink-0 text-sky-400" />
              <span>
                Link type: <span className="font-mono text-zinc-300">{plan.linkTypeName}</span>
                {plan.note && <span className="block text-zinc-500">{plan.note}</span>}
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-2 text-[12px] text-amber-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{plan.blockedReason}</span>
            </div>
          )}

          {plan.canWrapInEthernet && wrapInEthernet && (
            <button
              className="self-start cursor-pointer rounded-md border border-zinc-700 px-2.5 py-1 text-[12px] text-zinc-300 hover:border-cyan-600 hover:text-cyan-300"
              onClick={wrapInEthernet}
            >
              Wrap stack in Ethernet
            </button>
          )}

          {hasErrors && (
            <div className="flex items-start gap-2 text-[12px] text-rose-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              The stack has validation errors — the exported packets will be malformed.
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
              Content
            </label>
            <div className="flex flex-col gap-1">
              {options.map((s) => (
                <label
                  key={s.id}
                  className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 ${
                    scenarioId === s.id
                      ? 'border-cyan-700 bg-cyan-500/5'
                      : 'border-zinc-800 hover:border-zinc-600'
                  }`}
                >
                  <input
                    type="radio"
                    className="mt-1 accent-cyan-500"
                    checked={scenarioId === s.id}
                    onChange={() => setScenarioId(s.id)}
                  />
                  <span>
                    <span className="block text-[13px] text-zinc-200">{s.name}</span>
                    <span className="block text-[11px] text-zinc-500">{s.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <fieldset>
            <legend className="mb-1.5 block text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
              Format
            </legend>
            <div className="flex flex-col gap-1">
              {FORMATS.map((f) => (
                <label
                  key={f.id}
                  className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 ${
                    format === f.id
                      ? 'border-cyan-700 bg-cyan-500/5'
                      : 'border-zinc-800 hover:border-zinc-600'
                  }`}
                >
                  <input
                    type="radio"
                    name="export-format"
                    className="mt-1 accent-cyan-500"
                    checked={format === f.id}
                    onChange={() => {
                      setFormat(f.id);
                      setFilename((current) => withExtension(current, f.extension));
                    }}
                  />
                  <span>
                    <span className="block text-[13px] text-zinc-200">{f.name}</span>
                    <span className="block text-[11px] text-zinc-500">{f.note}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
              Filename
            </span>
            <input
              className="w-full rounded border border-zinc-700 bg-zinc-950/60 px-2 py-1 font-mono text-[13px] text-zinc-200 outline-none focus:border-cyan-600"
              value={filename}
              spellCheck={false}
              onChange={(e) => setFilename(e.target.value)}
            />
          </label>

          {error && <p className="text-[12px] text-rose-400">{error}</p>}
        </div>

        <footer className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
          <button
            className="cursor-pointer rounded-md px-3 py-1.5 text-[13px] text-zinc-400 hover:text-zinc-200"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="flex cursor-pointer items-center gap-1.5 rounded-md bg-cyan-700 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-cyan-600 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
            disabled={!plan.ok}
            onClick={download}
          >
            <Download className="size-3.5" />
            Download
          </button>
        </footer>
      </div>
    </div>
  );
}
