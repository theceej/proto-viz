import { useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useEscape, useModalFocus } from '../a11y';
import type { Registry } from '../../core/registry';
import {
  decodeStackBytes,
  parseHexInput,
  type DecodedStack,
} from '../../core/decodeStack';
import { useStackStore } from '../../store/stackStore';

/** First-layer choices shown before the full alphabetical list. */
const COMMON_STARTS = ['ethernet', 'ethernet-8023', 'ipv4', 'ipv6'];

/** Paste packet hex and load the identified stack into the builder. */
export default function DecodeDialog({
  registry,
  onClose,
}: {
  registry: Registry;
  onClose: () => void;
}) {
  const restoreStack = useStackStore((s) => s.restoreStack);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEscape(true, onClose);
  useModalFocus(dialogRef);

  const [input, setInput] = useState('');
  const [startId, setStartId] = useState('ethernet');

  const common = COMMON_STARTS.map((id) => registry.get(id)).filter(
    (p) => p !== undefined,
  );
  const others = registry
    .all()
    .filter((p) => !COMMON_STARTS.includes(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const preview = useMemo((): { decoded: DecodedStack; bytes: number } | { error: string } | null => {
    if (input.trim() === '') return null;
    try {
      const bytes = parseHexInput(input);
      return { decoded: decodeStackBytes(bytes, registry, startId), bytes: bytes.length };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [input, startId, registry]);

  const decoded = preview && 'decoded' in preview ? preview.decoded : null;
  const load = () => {
    if (!decoded || decoded.layers.length === 0) return;
    restoreStack(decoded.layers, decoded.payload);
    onClose();
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
        aria-labelledby="decode-dialog-title"
        className="w-[min(30rem,calc(100vw-2rem))] rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center border-b border-zinc-800 px-5 py-3">
          <h2 id="decode-dialog-title" className="text-[14px] font-semibold text-zinc-100">
            Decode packet bytes
          </h2>
          <button
            className="ml-auto cursor-pointer rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Close decode dialog"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex flex-col gap-3 px-5 py-4">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
              Packet hex
            </span>
            <textarea
              className="h-24 w-full resize-y rounded border border-zinc-700 bg-zinc-950/60 px-2 py-1.5 font-mono text-[12px] leading-5 text-zinc-200 outline-none focus:border-cyan-600"
              placeholder="02 00 00 00 00 01 02 00 00 00 00 02 08 00 45 00 …"
              value={input}
              spellCheck={false}
              aria-invalid={preview !== null && 'error' in preview}
              onChange={(e) => setInput(e.target.value)}
            />
          </label>
          <p className="-mt-2 text-[11px] leading-relaxed text-zinc-500">
            Plain hex digits — spaces, colons, or 0x prefixes are fine — plus
            hex dumps (xxd, tcpdump -X, hexdump -C, od), C byte arrays, and
            base64. The hex view's copy button and Wireshark's “copy as hex
            stream” both produce plain hex.
          </p>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
              First layer
            </span>
            <select
              className="w-full cursor-pointer rounded border border-zinc-700 bg-zinc-950/60 px-2 py-1.5 text-[13px] text-zinc-200 outline-none focus:border-cyan-600"
              value={startId}
              onChange={(e) => setStartId(e.target.value)}
            >
              <optgroup label="Common">
                {common.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="All protocols">
                {others.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>

          <div className="min-h-10 text-[11px]" aria-live="polite">
            {preview && 'error' in preview && (
              <span className="text-rose-400">{preview.error}</span>
            )}
            {decoded && (
              <div className="flex flex-col gap-1">
                <span className="font-mono text-zinc-400">
                  {decoded.layers.length > 0
                    ? decoded.layers
                        .map((l) => registry.get(l.protocolId)?.name ?? l.protocolId)
                        .join(' › ')
                    : 'no layers decoded'}
                  {decoded.payload.length > 0 &&
                    ` › ${decoded.payload.length}-byte payload`}
                </span>
                {decoded.layers.length > 0 && (
                  <span className={decoded.exact ? 'text-emerald-400' : 'text-amber-300'}>
                    {decoded.exact
                      ? 'Re-serializing reproduces the input exactly.'
                      : 'The decode is not byte-exact — see notes.'}
                  </span>
                )}
                {decoded.notes.map((n, i) => (
                  <span key={i} className="text-zinc-500">
                    {n}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <footer className="flex items-center gap-2 border-t border-zinc-800 px-5 py-3">
          <p className="mr-auto text-[11px] text-zinc-600">
            Mismatched computed fields (e.g. a wrong checksum) are pinned so the
            exact bytes are kept.
          </p>
          <button
            className="cursor-pointer rounded-md px-3 py-1.5 text-[13px] text-zinc-400 hover:text-zinc-200"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="cursor-pointer rounded-md bg-cyan-700 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-cyan-600 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
            disabled={!decoded || decoded.layers.length === 0}
            onClick={load}
          >
            Load stack
          </button>
        </footer>
      </div>
    </div>
  );
}
