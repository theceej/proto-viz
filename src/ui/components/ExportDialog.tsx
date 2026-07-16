import { useMemo, useState } from 'react';
import { AlertTriangle, Download, Info, X } from 'lucide-react';
import type { StackInstance } from '../../core/model';
import type { Registry } from '../../core/registry';
import type { ValidationIssue } from '../../core/validate';
import { planExport } from '../../core/exporter';
import { applicableScenarios } from '../../core/scenarios';
import { serializeStack } from '../../core/serialize';
import { writePcap, type PcapPacket } from '../../core/pcap';
import { useStackStore } from '../../store/stackStore';

export default function ExportDialog({
  stack,
  registry,
  validation,
  onClose,
}: {
  stack: StackInstance;
  registry: Registry;
  validation: ValidationIssue[];
  onClose: () => void;
}) {
  const insertLayer = useStackStore((s) => s.insertLayer);
  const [scenarioId, setScenarioId] = useState('single');
  const [filename, setFilename] = useState('proto-viz.pcap');
  const [error, setError] = useState<string | null>(null);

  const plan = useMemo(() => planExport(stack, registry), [stack, registry]);
  const options = useMemo(() => applicableScenarios(stack, registry), [stack, registry]);
  const hasErrors = validation.some((v) => v.severity === 'error');

  const download = () => {
    try {
      const scenario = options.find((s) => s.id === scenarioId) ?? options[0]!;
      const plans = scenario.generate(stack, registry);
      const baseSec = Math.floor(Date.now() / 1000);
      const packets: PcapPacket[] = plans.map((p) => {
        const serialized = serializeStack(p.stack, registry);
        return {
          bytes: serialized.bytes,
          tsSec: baseSec + Math.floor(p.atUsec / 1_000_000),
          tsUsec: p.atUsec % 1_000_000,
        };
      });
      const file = writePcap(packets, plan.linkType!);
      const url = URL.createObjectURL(
        new Blob([file.buffer as ArrayBuffer], { type: 'application/vnd.tcpdump.pcap' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = filename.endsWith('.pcap') ? filename : `${filename}.pcap`;
      a.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[26rem] rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center border-b border-zinc-800 px-5 py-3">
          <h2 className="text-[14px] font-semibold text-zinc-100">Export PCAP</h2>
          <button
            className="ml-auto cursor-pointer rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex flex-col gap-4 px-5 py-4">
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

          {plan.canWrapInEthernet && (
            <button
              className="self-start cursor-pointer rounded-md border border-zinc-700 px-2.5 py-1 text-[12px] text-zinc-300 hover:border-cyan-600 hover:text-cyan-300"
              onClick={() => insertLayer('ethernet', 0)}
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

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
              Filename
            </label>
            <input
              className="w-full rounded border border-zinc-700 bg-zinc-950/60 px-2 py-1 font-mono text-[13px] text-zinc-200 outline-none focus:border-cyan-600"
              value={filename}
              spellCheck={false}
              onChange={(e) => setFilename(e.target.value)}
            />
          </div>

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
