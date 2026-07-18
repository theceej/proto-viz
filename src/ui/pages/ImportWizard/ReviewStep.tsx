import { useMemo } from 'react';
import { AlertTriangle, ArrowRight, Plus, Trash2 } from 'lucide-react';
import type { FieldType } from '../../../core/model';
import { newLayer } from '../../../core/model';
import { createRegistry } from '../../../core/registry';
import { serializeStack } from '../../../core/serialize';
import { draftToDefinition, type DraftField } from '../../../import/draft';
import { enumTables } from '../../../protocols';
import BitGrid from '../../components/BitGrid';
import { layerColor } from '../../colors';
import { bitsLabel } from '../../format';
import { FIELD_TYPES } from './constants';
import { BackButton, ConfidenceBadge } from './atoms';

/** Step 3: edit the parsed field table, with a live single-layer preview. */
export default function ReviewStep({
  fields,
  setFields,
  warnings,
  confidence,
  onBack,
  onNext,
}: {
  fields: DraftField[];
  setFields: (f: DraftField[]) => void;
  warnings: string[];
  confidence: number;
  onBack: () => void;
  onNext: () => void;
}) {
  const totalBits = fields.reduce((n, f) => n + f.bitLength, 0);
  const registry = useMemo(() => createRegistry([], enumTables), []);

  // Live preview: serialize a single-layer stack of the draft.
  const preview = useMemo(() => {
    try {
      const def = draftToDefinition(
        { name: 'preview', fields, warnings: [], confidence: 1 },
        { id: 'preview', name: 'Preview', layerHint: 'application', encapsulations: [] },
      );
      // Give variable fields a visible placeholder size.
      for (const f of def.fields) {
        if (f.bitLength === 'auto') f.default = new Uint8Array(4);
      }
      const reg = createRegistry([def], enumTables);
      const packet = serializeStack({ layers: [newLayer('preview')] }, reg);
      return { def, packet };
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, registry]);

  const update = (i: number, patch: Partial<DraftField>) =>
    setFields(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center gap-3">
        <ConfidenceBadge value={confidence} />
        <span
          className={`font-mono text-[12px] ${totalBits % 8 === 0 ? 'text-zinc-400' : 'text-amber-400'}`}
        >
          total {bitsLabel(totalBits)}
          {totalBits % 8 !== 0 && ' — not byte-aligned!'}
        </span>
      </div>
      {warnings.map((w, i) => (
        <p key={i} className="flex items-start gap-1.5 text-[12px] text-amber-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {w}
        </p>
      ))}

      <div className="min-h-0 overflow-auto rounded-lg border border-zinc-800">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-zinc-900 text-left text-[11px] tracking-widest text-zinc-500 uppercase">
            <tr>
              <th className="px-3 py-2">Field</th>
              <th className="px-2 py-2">Bits</th>
              <th className="px-2 py-2">Type</th>
              <th className="px-2 py-2">Notes</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => (
              <tr key={i} className="border-t border-zinc-800/60">
                <td className="px-3 py-1">
                  <input
                    className={`w-full rounded border bg-zinc-950/60 px-2 py-0.5 text-zinc-200 outline-none focus:border-cyan-600 ${
                      f.flags.includes('unnamed') ? 'border-amber-600' : 'border-zinc-800'
                    }`}
                    aria-label={`Field ${i + 1} name`}
                    value={f.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    className={`w-16 rounded border bg-zinc-950/60 px-2 py-0.5 font-mono text-zinc-200 outline-none focus:border-cyan-600 ${
                      f.flags.includes('misaligned') ? 'border-amber-600' : 'border-zinc-800'
                    }`}
                    aria-label={`${f.name || `Field ${i + 1}`} bit length`}
                    value={f.bitLength}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isInteger(n) && n >= 0) update(i, { bitLength: n });
                    }}
                  />
                </td>
                <td className="px-2 py-1">
                  <select
                    className="rounded border border-zinc-800 bg-zinc-950/60 px-1 py-0.5 text-zinc-200"
                    aria-label={`${f.name || `Field ${i + 1}`} type`}
                    value={f.type}
                    onChange={(e) => update(i, { type: e.target.value as FieldType })}
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  {f.variable && <span className="ml-1 text-[10px] text-zinc-500">var</span>}
                </td>
                <td className="px-2 py-1 text-[11px] text-zinc-500">
                  {[...f.flags, f.inference].filter(Boolean).join(', ')}
                </td>
                <td className="px-2 py-1">
                  <button
                    className="cursor-pointer p-1.5 text-zinc-600 hover:text-rose-400"
                    aria-label={`Remove field ${f.name || i + 1}`}
                    onClick={() => setFields(fields.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        className="flex w-fit cursor-pointer items-center gap-1 text-[12px] text-cyan-400 hover:text-cyan-300"
        onClick={() =>
          setFields([
            ...fields,
            { id: `field${fields.length}`, name: 'New Field', bitLength: 8, type: 'uint', variable: false, flags: [] },
          ])
        }
      >
        <Plus className="size-3.5" /> Add field
      </button>

      {preview && preview.packet.layers[0] && (
        <div>
          <h3 className="mb-1 text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
            Live preview
          </h3>
          <BitGrid
            def={preview.def}
            layout={preview.packet.layers[0]}
            spans={preview.packet.spans}
            color={layerColor(2)}
          />
        </div>
      )}

      <div className="flex justify-between">
        <BackButton onClick={onBack} />
        <button
          className="flex cursor-pointer items-center gap-1.5 rounded-md bg-cyan-700 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-cyan-600 disabled:bg-zinc-800 disabled:text-zinc-500"
          disabled={fields.length === 0}
          onClick={onNext}
        >
          Continue
          <ArrowRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
