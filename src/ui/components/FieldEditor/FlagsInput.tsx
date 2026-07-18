import type { FieldDef, FieldValue } from '../../../core/model';
import { valueToNumber } from '../../../core/values';

/** Checkbox row for a `flags` field; bit 0 is the most significant bit. */
export default function FlagsInput({
  field,
  value,
  onCommit,
}: {
  field: FieldDef;
  value: FieldValue | undefined;
  onCommit: (v: FieldValue) => void;
}) {
  const width = typeof field.bitLength === 'number' ? field.bitLength : 8;
  let n = 0;
  try {
    n = value !== undefined ? valueToNumber(field, value) : 0;
  } catch {
    n = 0;
  }
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {(field.flags ?? []).map((f) => {
        const mask = 1 << (width - 1 - f.bit);
        const on = (n & mask) !== 0;
        return (
          <label
            key={f.bit}
            className={`flex cursor-pointer items-center gap-1 py-0.5 font-mono text-[11px] ${
              on ? 'text-cyan-300' : 'text-zinc-500'
            }`}
            title={f.description}
          >
            <input
              type="checkbox"
              className="size-4 accent-cyan-500"
              checked={on}
              onChange={() => onCommit(on ? n & ~mask : n | mask)}
            />
            {f.name}
          </label>
        );
      })}
    </div>
  );
}
