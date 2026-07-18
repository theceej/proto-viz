import { ArrowLeft } from 'lucide-react';
import type { Step } from './constants';

/** Progress breadcrumb across the four wizard steps. */
export function StepIndicator({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'upload', label: 'Upload' },
    { key: 'pick', label: 'Detect' },
    { key: 'review', label: 'Review fields' },
    { key: 'metadata', label: 'Save' },
  ];
  const activeIdx = steps.findIndex((s) => s.key === step);
  return (
    <div className="mt-4 flex items-center gap-2">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] ${
              i === activeIdx
                ? 'bg-cyan-500/15 font-medium text-cyan-300'
                : i < activeIdx
                  ? 'text-emerald-400'
                  : 'text-zinc-600'
            }`}
          >
            {i < activeIdx ? '✓ ' : ''}
            {s.label}
          </span>
          {i < steps.length - 1 && <span className="text-zinc-700">→</span>}
        </div>
      ))}
    </div>
  );
}

export function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const cls =
    value >= 0.8
      ? 'bg-emerald-500/15 text-emerald-300'
      : value >= 0.5
        ? 'bg-amber-500/15 text-amber-300'
        : 'bg-rose-500/15 text-rose-300';
  return <span className={`rounded px-2 py-0.5 text-[11px] ${cls}`}>{pct}% confidence</span>;
}

export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-[13px] text-zinc-400 hover:text-zinc-200"
      onClick={onClick}
    >
      <ArrowLeft className="size-3.5" />
      Back
    </button>
  );
}

export function LabeledInput({
  label,
  value,
  onChange,
  mono,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
        {label}
      </span>
      <input
        className={`w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[13px] text-zinc-200 outline-none focus:border-cyan-600 ${
          mono ? 'font-mono' : ''
        }`}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
