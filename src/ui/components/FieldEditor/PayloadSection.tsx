import { useState } from 'react';
import { Dices } from 'lucide-react';
import { randomPayload } from '../../../core/random';
import { parseHexBytes } from '../../../core/values';
import { useStackStore } from '../../../store/stackStore';

/** Editor for the stack's trailing payload, in either text or hex mode. */
export default function PayloadSection() {
  const payload = useStackStore((s) => s.trailingPayload);
  const setPayload = useStackStore((s) => s.setPayload);
  const [mode, setMode] = useState<'text' | 'hex'>('text');
  const [draft, setDraft] = useState(() => new TextDecoder().decode(payload));
  const [invalid, setInvalid] = useState(false);
  // Payload values this component itself committed; anything else is an
  // external change (preset, saved stack, random) and must resync the draft.
  const [lastLocal, setLastLocal] = useState(payload);

  const formatFor = (m: 'text' | 'hex', bytes: Uint8Array) =>
    m === 'text'
      ? new TextDecoder().decode(bytes)
      : [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');

  // Render-time adjustment (not an effect): when the payload changed and it
  // wasn't this component's own commit, resync the draft text.
  const [prevPayload, setPrevPayload] = useState(payload);
  if (payload !== prevPayload) {
    setPrevPayload(payload);
    if (payload !== lastLocal) {
      setDraft(formatFor(mode, payload));
      setInvalid(false);
    }
  }

  const switchMode = (m: 'text' | 'hex') => {
    setMode(m);
    setInvalid(false);
    setDraft(formatFor(m, payload));
  };

  const randomize = () => {
    const bytes = randomPayload();
    setLastLocal(bytes);
    setPayload(bytes);
    setMode('hex');
    setDraft(formatFor('hex', bytes));
    setInvalid(false);
  };

  return (
    <section className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40">
      <header className="flex items-center gap-2 border-b border-zinc-800 border-l-3 border-l-zinc-500 px-3 py-2">
        <span className="text-[13px] font-semibold text-zinc-100">Payload</span>
        <span className="font-mono text-[11px] text-zinc-500">{payload.length} bytes</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            className="mr-1 cursor-pointer rounded p-1.5 text-zinc-500 hover:text-fuchsia-300"
            title="Fill with random bytes"
            aria-label="Fill payload with random bytes"
            onClick={randomize}
          >
            <Dices className="size-3.5" />
          </button>
          {(['text', 'hex'] as const).map((m) => (
            <button
              key={m}
              className={`cursor-pointer rounded px-2 py-0.5 text-[11px] ${
                mode === m ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
              }`}
              onClick={() => switchMode(m)}
            >
              {m}
            </button>
          ))}
        </div>
      </header>
      <textarea
        className={`block h-20 w-full resize-y bg-transparent px-3 py-2 font-mono text-[12px] text-zinc-300 outline-none placeholder:text-zinc-600 ${
          invalid ? 'text-rose-400' : ''
        }`}
        placeholder={mode === 'text' ? 'Optional payload text…' : 'de ad be ef…'}
        aria-label={`Payload (${mode})`}
        aria-invalid={invalid || undefined}
        value={draft}
        spellCheck={false}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          if (mode === 'text') {
            const bytes = new TextEncoder().encode(text);
            setLastLocal(bytes);
            setPayload(bytes);
            setInvalid(false);
          } else {
            try {
              const bytes = parseHexBytes(text);
              setLastLocal(bytes);
              setPayload(bytes);
              setInvalid(false);
            } catch {
              setInvalid(true);
            }
          }
        }}
      />
    </section>
  );
}
