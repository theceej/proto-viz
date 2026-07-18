import { useMemo, useState } from 'react';
import type { EnumTable, FieldDef, FieldValue } from '../../../core/model';
import { toEditString, tryParse } from './fieldValueText';

/**
 * Single-line editor for every non-flags field type. Keeps a local draft so
 * partially-typed input isn't reformatted mid-edit, adopts external value
 * changes (e.g. a binding re-set), and offers enum values via a datalist.
 */
export default function TextValueInput({
  field,
  value,
  enumTable,
  onCommit,
}: {
  field: FieldDef;
  value: FieldValue | undefined;
  enumTable: EnumTable | undefined;
  onCommit: (v: FieldValue) => void;
}) {
  const external = useMemo(() => toEditString(field, value), [field, value]);
  const [draft, setDraft] = useState(external);
  const [invalid, setInvalid] = useState(false);

  // Render-time adjustment: adopt external changes (e.g. a binding re-set
  // the value) — but leave the draft alone when it already represents the
  // committed value, so typing "10000" isn't reformatted to "0x2710" mid-edit.
  const [prevExternal, setPrevExternal] = useState(external);
  if (external !== prevExternal) {
    setPrevExternal(external);
    const parsed = tryParse(field, draft);
    const draftStillMatches =
      parsed !== null && toEditString(field, parsed.value) === external;
    if (!draftStillMatches) {
      setDraft(external);
      setInvalid(false);
    }
  }

  const listId = enumTable ? `enum-${field.id}-${enumTable.id}` : undefined;

  return (
    <>
      <input
        className={`w-full rounded border bg-zinc-950/60 px-2 py-0.5 font-mono text-[12px] text-zinc-200 outline-none focus:border-cyan-600 ${
          invalid ? 'border-rose-500' : 'border-zinc-700/60'
        }`}
        value={draft}
        list={listId}
        aria-label={field.name}
        aria-invalid={invalid || undefined}
        spellCheck={false}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          const parsed = tryParse(field, text);
          if (parsed !== null) {
            setInvalid(false);
            onCommit(parsed.value);
          } else {
            setInvalid(true);
          }
        }}
        onBlur={() => {
          if (invalid) {
            setDraft(external);
            setInvalid(false);
          }
        }}
      />
      {enumTable && listId && (
        <datalist id={listId}>
          {Object.entries(enumTable.values).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </datalist>
      )}
    </>
  );
}
