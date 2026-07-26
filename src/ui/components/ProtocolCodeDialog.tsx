import { useMemo, useRef, useState } from 'react';
import { Copy, Download, X } from 'lucide-react';
import {
  generateProtocolCode,
  type CodeTarget,
} from '../../core/codegen';
import type { ProtocolDefinition } from '../../core/model';
import { useEscape, useModalFocus } from '../a11y';

const TARGETS: { value: CodeTarget; label: string }[] = [
  { value: 'c', label: 'C / C++' },
  { value: 'scapy', label: 'Python (Scapy)' },
  { value: 'rust', label: 'Rust (zerocopy)' },
  { value: 'wireshark-lua', label: 'Wireshark Lua' },
  { value: 'go', label: 'Go' },
];

export default function ProtocolCodeDialog({
  definition,
  onClose,
}: {
  definition: ProtocolDefinition;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<CodeTarget>('c');
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle');
  const [copyError, setCopyError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const generated = useMemo(() => generateProtocolCode(definition, target), [definition, target]);
  useEscape(true, onClose);
  useModalFocus(dialogRef);

  const copy = async () => {
    setCopyState('copying');
    setCopyError('');
    try {
      await navigator.clipboard.writeText(generated.code);
      setCopyState('copied');
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : String(error));
      setCopyState('error');
    }
  };

  const download = () => {
    const url = URL.createObjectURL(
      new Blob([generated.code], { type: `${generated.mimeType};charset=utf-8` }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = generated.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="protocol-code-title"
        className="flex h-[min(52rem,calc(100vh-1rem))] w-[min(68rem,calc(100vw-1rem))] min-w-0 flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id="protocol-code-title" className="truncate text-[14px] font-semibold text-zinc-100">
              Export {definition.name} header code
            </h2>
            <p className="truncate font-mono text-[11px] text-zinc-500">{generated.filename}</p>
          </div>
          <button
            className="ml-auto cursor-pointer rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Close protocol code export dialog"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4 sm:px-5">
          <label className="w-full text-[12px] text-zinc-400 sm:w-64">
            Target
            <select
              className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-200"
              value={target}
              onChange={(event) => {
                setTarget(event.target.value as CodeTarget);
                setCopyState('idle');
              }}
            >
              {TARGETS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          {generated.warnings.length > 0 && (
            <section
              aria-label="Generation warnings"
              className="max-h-28 shrink-0 overflow-auto rounded border border-amber-800/60 bg-amber-950/20 px-3 py-2"
            >
              <ul className="space-y-1 text-[11px] text-amber-300">
                {generated.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </section>
          )}

          <pre
            className="min-h-0 flex-1 overflow-auto rounded border border-zinc-700 bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-300"
            aria-label="Generated protocol code"
            tabIndex={0}
          ><code>{generated.code}</code></pre>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3 sm:px-5">
          <span
            className={`mr-auto text-[12px] ${copyState === 'error' ? 'text-rose-400' : 'text-emerald-400'}`}
            role="status"
            aria-live="polite"
          >
            {copyState === 'copied'
              ? 'Code copied'
              : copyState === 'error'
                ? `Clipboard copy failed: ${copyError}`
                : ''}
          </span>
          <button
            className="cursor-pointer px-3 py-1.5 text-[13px] text-zinc-400"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-[13px] font-medium text-zinc-200 hover:border-cyan-600 disabled:cursor-wait disabled:opacity-60"
            disabled={copyState === 'copying'}
            onClick={() => void copy()}
          >
            <Copy className="size-3.5" />
            {copyState === 'copying' ? 'Copying...' : copyState === 'copied' ? 'Copy again' : 'Copy code'}
          </button>
          <button
            className="flex cursor-pointer items-center gap-1.5 rounded-md bg-cyan-700 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-cyan-600"
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
