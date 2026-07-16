import { AlertTriangle, CheckCircle2, Info, OctagonX } from 'lucide-react';
import type { ValidationIssue } from '../../core/validate';
import type { SerializeIssue } from '../../core/serialize';

const STYLES = {
  error: { icon: OctagonX, cls: 'text-rose-400' },
  warning: { icon: AlertTriangle, cls: 'text-amber-400' },
  info: { icon: Info, cls: 'text-sky-400' },
} as const;

/** Compact list of validation + serialization issues under the stack strip. */
export default function ValidationPanel({
  validation,
  serializeIssues,
}: {
  validation: ValidationIssue[];
  serializeIssues: SerializeIssue[];
}) {
  const items: { severity: keyof typeof STYLES; message: string; suggestion?: string }[] = [
    ...validation.map((v) => ({
      severity: v.severity,
      message: v.message,
      suggestion: v.suggestion,
    })),
    ...serializeIssues.map((s) => ({ severity: s.severity, message: s.message })),
  ];

  if (items.length === 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-1.5 px-6 pb-2 text-[12px] text-emerald-400"
      >
        <CheckCircle2 className="size-3.5" aria-hidden />
        Stack is valid.
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-1 px-6 pb-2">
      {items.map((item, i) => {
        const { icon: Icon, cls } = STYLES[item.severity];
        return (
          <div key={i} className="flex items-start gap-1.5 text-[12px] text-zinc-300">
            <Icon
              className={`mt-0.5 size-3.5 shrink-0 ${cls}`}
              role="img"
              aria-label={item.severity}
            />
            <span>
              {item.message}
              {item.suggestion && <span className="text-zinc-500"> {item.suggestion}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
