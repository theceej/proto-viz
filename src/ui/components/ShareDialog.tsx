import { useMemo, useRef, useState } from 'react';
import { Check, Copy, Link, X } from 'lucide-react';
import { useEscape, useModalFocus } from '../a11y';
import type { StackInstance } from '../../core/model';
import type { Registry } from '../../core/registry';
import { ShareCodeError, decodeShare, encodeShare } from '../../core/share';
import { encodePacketBlob } from '../../core/shareBlob';
import { useStackStore } from '../../store/stackStore';

/** Share the current stack as a word code, or load a stack from one. */
export default function ShareDialog({
  stack,
  registry,
  onClose,
}: {
  stack: StackInstance;
  registry: Registry;
  onClose: () => void;
}) {
  const setStack = useStackStore((s) => s.setStack);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEscape(true, onClose);
  useModalFocus(dialogRef);

  const encoded = useMemo(() => {
    try {
      const code = encodeShare(stack.layers.map((l) => l.protocolId));
      const base = `${location.origin}${location.pathname}#/builder?s=${code}`;
      // The exact-packet link adds field edits + payload; absent when there
      // are none, or reports why it can't be built (e.g. too large to share).
      let exactLink: string | undefined;
      let exactError: string | undefined;
      try {
        const blob = encodePacketBlob(stack, registry);
        if (blob) exactLink = `${base}&e=${blob}`;
      } catch (e) {
        exactError = (e as Error).message;
      }
      return { code, structureLink: base, exactLink, exactError };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [stack, registry]);

  const [copied, setCopied] = useState<'code' | 'link' | 'exact' | null>(null);
  const copy = (kind: 'code' | 'link' | 'exact', text: string) => {
    navigator.clipboard.writeText(text).then(() => setCopied(kind));
  };
  const shareLink = encoded.structureLink ?? '';

  const [input, setInput] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadPreview = useMemo(() => {
    if (input.trim() === '') return null;
    try {
      return { ids: decodeShare(input) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [input]);

  const load = () => {
    try {
      setStack(decodeShare(input));
      onClose();
    } catch (e) {
      setLoadError(
        e instanceof ShareCodeError ? e.message : 'Could not load that code.',
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
        className="w-[26rem] rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center border-b border-zinc-800 px-5 py-3">
          <h2 id="share-dialog-title" className="text-[14px] font-semibold text-zinc-100">
            Share stack
          </h2>
          <button
            className="ml-auto cursor-pointer rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Close share dialog"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex flex-col gap-4 px-5 py-4">
          <div>
            <div className="mb-1.5 text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
              This stack as words
            </div>
            {encoded.code ? (
              <>
                <div className="rounded-md border border-zinc-700 bg-zinc-950/60 px-3 py-2.5 text-center font-mono text-[15px] tracking-wide text-cyan-300 select-all">
                  {encoded.code}
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    className="flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1.5 text-[12px] text-zinc-300 hover:border-cyan-600 hover:text-cyan-300"
                    onClick={() => copy('code', encoded.code)}
                  >
                    {copied === 'code' ? (
                      <Check className="size-3.5 text-emerald-400" aria-hidden />
                    ) : (
                      <Copy className="size-3.5" aria-hidden />
                    )}
                    {copied === 'code' ? 'Copied' : 'Copy words'}
                  </button>
                  <button
                    className="flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1.5 text-[12px] text-zinc-300 hover:border-cyan-600 hover:text-cyan-300"
                    onClick={() => copy('link', shareLink)}
                  >
                    {copied === 'link' ? (
                      <Check className="size-3.5 text-emerald-400" aria-hidden />
                    ) : (
                      <Link className="size-3.5" aria-hidden />
                    )}
                    {copied === 'link' ? 'Copied' : 'Copy link'}
                  </button>
                  {encoded.exactLink && (
                    <button
                      className="flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1.5 text-[12px] text-zinc-300 hover:border-cyan-600 hover:text-cyan-300"
                      onClick={() => copy('exact', encoded.exactLink!)}
                    >
                      {copied === 'exact' ? (
                        <Check className="size-3.5 text-emerald-400" aria-hidden />
                      ) : (
                        <Link className="size-3.5" aria-hidden />
                      )}
                      {copied === 'exact' ? 'Copied' : 'Copy exact-packet link'}
                    </button>
                  )}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                  The words and plain link capture the layer sequence only.
                  {encoded.exactLink
                    ? ' The exact-packet link also restores your field edits and payload.'
                    : encoded.exactError
                      ? ` Field edits can’t be added to a link here: ${encoded.exactError}`
                      : ' This stack has no field edits or payload to add.'}
                </p>
              </>
            ) : (
              <p className="text-[12px] text-amber-300">{encoded.error}</p>
            )}
          </div>

          <div className="border-t border-zinc-800 pt-4">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
                Have a code? Load it
              </span>
              <input
                className="w-full rounded border border-zinc-700 bg-zinc-950/60 px-2 py-1.5 font-mono text-[13px] text-zinc-200 outline-none focus:border-cyan-600"
                placeholder="army.borrow.advice"
                value={input}
                spellCheck={false}
                aria-invalid={loadPreview?.error !== undefined}
                onChange={(e) => {
                  setInput(e.target.value);
                  setLoadError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && loadPreview?.ids) load();
                }}
              />
            </label>
            <div className="mt-1.5 min-h-4 text-[11px]" aria-live="polite">
              {loadPreview?.ids && (
                <span className="font-mono text-zinc-400">
                  {loadPreview.ids
                    .map((id) => registry.get(id)?.name ?? id)
                    .join(' › ')}
                </span>
              )}
              {input.trim() !== '' && loadPreview?.error && (
                <span className="text-rose-400">{loadPreview.error}</span>
              )}
              {loadError && <span className="text-rose-400">{loadError}</span>}
            </div>
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
          <button
            className="cursor-pointer rounded-md px-3 py-1.5 text-[13px] text-zinc-400 hover:text-zinc-200"
            onClick={onClose}
          >
            Close
          </button>
          <button
            className="cursor-pointer rounded-md bg-cyan-700 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-cyan-600 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
            disabled={!loadPreview?.ids}
            onClick={load}
          >
            Load stack
          </button>
        </footer>
      </div>
    </div>
  );
}
