import { useMemo, useState } from 'react';
import { ChevronDown, FlaskConical } from 'lucide-react';
import type { StackInstance } from '../../core/model';
import type { Registry } from '../../core/registry';
import type { SerializedPacket } from '../../core/serialize';
import { applicableExperiments, type ExperimentApplication } from '../../core/experiments';
import { useStackStore } from '../../store/stackStore';
import { useEscape } from '../a11y';
import { toolbarButtonClass } from './ToolbarButton';

/**
 * "Break this packet" menu: lists the malformed-packet experiments that apply
 * to the current stack. Applying one pins a single field to a deliberately
 * wrong value (via the normal pin action, so it is one undoable step) and
 * reports it back so the page can explain the resulting diagnostic.
 */
export default function ExperimentsMenu({
  stack,
  registry,
  packet,
  labelClass,
  onApply,
}: {
  stack: StackInstance;
  registry: Registry;
  packet: SerializedPacket | null;
  labelClass?: string;
  onApply: (application: ExperimentApplication) => void;
}) {
  const [open, setOpen] = useState(false);
  const pinField = useStackStore((s) => s.pinField);
  useEscape(open, () => setOpen(false));

  const experiments = useMemo(
    () => (packet ? applicableExperiments(stack, registry, packet) : []),
    [stack, registry, packet],
  );

  return (
    <div className="relative">
      <button
        type="button"
        className={toolbarButtonClass('hover:border-amber-500 hover:text-amber-300')}
        aria-label="Break this packet"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Introduce a deliberate wire-format error to see the diagnostic"
        disabled={experiments.length === 0}
        onClick={() => setOpen((o) => !o)}
      >
        <FlaskConical className="size-3.5 shrink-0" aria-hidden />
        <span className={labelClass}>Break</span>
        <ChevronDown className="size-3 shrink-0" aria-hidden />
      </button>
      {open && experiments.length > 0 && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute top-full left-0 z-20 mt-1 w-72 rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl shadow-black/50"
          >
            {experiments.map((experiment) => (
              <button
                key={experiment.experimentId}
                role="menuitem"
                className="block w-full cursor-pointer px-3 py-1.5 text-left text-[13px] text-zinc-200 hover:bg-zinc-800"
                onClick={() => {
                  pinField(experiment.layerUid, experiment.fieldId, experiment.value);
                  onApply(experiment);
                  setOpen(false);
                }}
              >
                {experiment.title}
                <span className="block text-[11px] text-zinc-500">
                  {experiment.layerName} · {experiment.fieldName}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
