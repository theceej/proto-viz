import { AlertTriangle, CheckCircle2, Info, OctagonX } from 'lucide-react';
import type { ValidationIssue } from '../../core/validate';
import type { SerializeIssue } from '../../core/serialize';
import type { SerializedPacket } from '../../core/serialize';
import { useHighlightStore, type FieldRef } from '../../store/highlightStore';

const STYLES = {
  error: { icon: OctagonX, cls: 'text-rose-400' },
  warning: { icon: AlertTriangle, cls: 'text-amber-400' },
  advisory: { icon: Info, cls: 'text-violet-400' },
  info: { icon: Info, cls: 'text-sky-400' },
} as const;

/** Compact list of validation + serialization issues under the stack strip. */
export default function ValidationPanel({
  validation,
  serializeIssues,
  packet,
}: {
  validation: ValidationIssue[];
  serializeIssues: SerializeIssue[];
  packet?: SerializedPacket | null;
}) {
  const toggleLocked = useHighlightStore((state) => state.toggleLocked);
  const items: { severity: keyof typeof STYLES; message: string; suggestion?: string; reference?: string; field?: FieldRef }[] = [
    ...validation.map((v) => ({
      severity: v.severity,
      message: v.message,
      suggestion: v.suggestion,
      reference: v.reference,
      field:
        v.fieldId && v.layerIndex >= 0 && packet?.layers[v.layerIndex]
          ? { layerUid: packet.layers[v.layerIndex]!.uid, fieldId: v.fieldId }
          : undefined,
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
            <span className="min-w-0">
              {item.message}
              {item.suggestion && <span className="text-zinc-500"> {item.suggestion}</span>}
              {item.reference && <span className="text-zinc-500"> {item.reference}</span>}
            </span>
            {item.field && (
              <button
                className="ml-auto shrink-0 cursor-pointer rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-cyan-600 hover:text-cyan-300"
                aria-label={`Inspect ${item.field.fieldId} field`}
                onClick={() => toggleLocked(item.field!)}
              >
                Inspect field
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
