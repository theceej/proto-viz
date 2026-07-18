import type { EnumTable, FieldDef, FieldValue } from '../../../core/model';
import FlagsInput from './FlagsInput';
import TextValueInput from './TextValueInput';

/** Dispatch to the editor for a field's type: checkboxes for flags, text otherwise. */
export default function FieldInput({
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
  if (field.type === 'flags') {
    return (
      <div role="group" aria-label={field.name}>
        <FlagsInput field={field} value={value} onCommit={onCommit} />
      </div>
    );
  }
  return <TextValueInput field={field} value={value} enumTable={enumTable} onCommit={onCommit} />;
}
