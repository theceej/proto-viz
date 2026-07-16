import { useMemo, useState } from 'react';
import { Dices, Lock, LockOpen, RotateCcw } from 'lucide-react';
import { randomPayload } from '../../core/random';
import type { EnumTable, FieldDef, FieldValue, LayerInstance } from '../../core/model';
import type { Registry } from '../../core/registry';
import type { SerializedPacket } from '../../core/serialize';
import {
  parseHexBytes,
  parseIPv4,
  parseIPv6,
  parseMac,
  valueToNumber,
} from '../../core/values';
import { useStackStore } from '../../store/stackStore';
import { isActive, useHighlightStore } from '../../store/highlightStore';
import { layerColor } from '../colors';
import { bitsLabel, formatFieldValue } from '../format';

/** Editable field tree for every layer in the stack, plus the trailing payload. */
export default function FieldEditor({
  layers,
  packet,
  registry,
}: {
  layers: LayerInstance[];
  packet: SerializedPacket | null;
  registry: Registry;
}) {
  return (
    <div className="flex flex-col gap-4 p-4">
      {layers.map((layer, i) => (
        <LayerSection
          key={layer.uid}
          layer={layer}
          layerIndex={i}
          packet={packet}
          registry={registry}
        />
      ))}
      <PayloadSection />
    </div>
  );
}

function LayerSection({
  layer,
  layerIndex,
  packet,
  registry,
}: {
  layer: LayerInstance;
  layerIndex: number;
  packet: SerializedPacket | null;
  registry: Registry;
}) {
  const def = registry.get(layer.protocolId);
  const color = layerColor(layerIndex);
  if (!def) return null;

  const spansById = new Map(
    (packet?.spans ?? []).filter((s) => s.layerUid === layer.uid).map((s) => [s.fieldId, s]),
  );

  return (
    <section className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40">
      <header
        className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2"
        style={{ borderLeft: `3px solid ${color.accent}` }}
      >
        <span className="text-[13px] font-semibold text-zinc-100">{def.name}</span>
        <span className="ml-auto font-mono text-[11px] text-zinc-500">
          {spansById.size > 0 && packet
            ? bitsLabel(
                (packet.layers.find((l) => l.uid === layer.uid)?.headerBytes ?? 0) * 8,
              )
            : ''}
        </span>
      </header>
      <div className="divide-y divide-zinc-800/60">
        {def.fields.map((field) => {
          const span = spansById.get(field.id);
          if (!span && packet) return null; // presentIf-hidden or zero-length
          return (
            <FieldRow
              key={field.id}
              layer={layer}
              field={field}
              value={span?.value ?? layer.overrides[field.id] ?? field.default}
              registry={registry}
            />
          );
        })}
      </div>
    </section>
  );
}

function FieldRow({
  layer,
  field,
  value,
  registry,
}: {
  layer: LayerInstance;
  field: FieldDef;
  value: FieldValue | undefined;
  registry: Registry;
}) {
  const { setHovered, toggleLocked } = useHighlightStore();
  const hovered = useHighlightStore((s) => s.hovered);
  const locked = useHighlightStore((s) => s.locked);
  const { setOverride, clearOverride, pinField, unpinField } = useStackStore();

  const active =
    isActive(hovered, layer.uid, field.id) || isActive(locked, layer.uid, field.id);
  const pinned = layer.pinned.includes(field.id);
  const isComputed = field.computed !== undefined;
  const editable = !isComputed || pinned;
  const hasOverride = field.id in layer.overrides;
  const enumTable = field.enumRef ? registry.getEnum(field.enumRef) : undefined;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 transition-colors ${
        active ? 'bg-zinc-800/70' : ''
      }`}
      onMouseEnter={() => setHovered({ layerUid: layer.uid, fieldId: field.id })}
      onMouseLeave={() => setHovered(null)}
    >
      <button
        className="w-32 shrink-0 cursor-pointer truncate text-left text-[12px] text-zinc-400 hover:text-zinc-200"
        title={field.description}
        onClick={() => toggleLocked({ layerUid: layer.uid, fieldId: field.id })}
      >
        {field.name}
      </button>

      <div className="min-w-0 flex-1">
        {editable ? (
          <FieldInput
            field={field}
            value={value}
            enumTable={enumTable}
            onCommit={(v) =>
              pinned ? pinField(layer.uid, field.id, v) : setOverride(layer.uid, field.id, v)
            }
          />
        ) : (
          <span
            className="block truncate font-mono text-[12px] text-zinc-300"
            title={value !== undefined ? formatFieldValue(field, value, enumTable) : ''}
          >
            {value !== undefined ? formatFieldValue(field, value, enumTable) : '—'}
          </span>
        )}
      </div>

      {isComputed && (
        <button
          className="shrink-0 cursor-pointer text-zinc-500 hover:text-zinc-200"
          title={
            pinned
              ? 'Pinned: manual value overrides the computed one. Click to restore auto.'
              : 'Computed automatically. Click to pin a manual value.'
          }
          onClick={() => {
            if (pinned) unpinField(layer.uid, field.id);
            else if (value !== undefined) pinField(layer.uid, field.id, value);
          }}
        >
          {pinned ? (
            <LockOpen className="size-3.5 text-amber-400" />
          ) : (
            <Lock className="size-3.5" />
          )}
        </button>
      )}
      {!isComputed && hasOverride && (
        <button
          className="shrink-0 cursor-pointer text-zinc-500 hover:text-zinc-200"
          title="Reset to default"
          onClick={() => clearOverride(layer.uid, field.id)}
        >
          <RotateCcw className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function FieldInput({
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
    return <FlagsInput field={field} value={value} onCommit={onCommit} />;
  }
  return <TextValueInput field={field} value={value} enumTable={enumTable} onCommit={onCommit} />;
}

function FlagsInput({
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
    <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
      {(field.flags ?? []).map((f) => {
        const mask = 1 << (width - 1 - f.bit);
        const on = (n & mask) !== 0;
        return (
          <label
            key={f.bit}
            className={`flex cursor-pointer items-center gap-1 font-mono text-[11px] ${
              on ? 'text-cyan-300' : 'text-zinc-500'
            }`}
            title={f.description}
          >
            <input
              type="checkbox"
              className="size-3 accent-cyan-500"
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

function TextValueInput({
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

function toEditString(field: FieldDef, value: FieldValue | undefined): string {
  if (value === undefined) return '';
  if (value instanceof Uint8Array) {
    if (field.type === 'bytes')
      return [...value].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    return formatFieldValue(field, value);
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    const n = Number(value);
    return typeof field.bitLength === 'number' && field.bitLength >= 16 && n > 9999
      ? `0x${n.toString(16)}`
      : String(n);
  }
  return String(value);
}

function tryParse(field: FieldDef, text: string): { value: FieldValue } | null {
  const t = text.trim();
  try {
    switch (field.type) {
      case 'uint': {
        if (!/^(0x[0-9a-fA-F]+|\d+)$/.test(t)) return null;
        const n = Number(t);
        const max = typeof field.bitLength === 'number' ? 2 ** field.bitLength - 1 : Infinity;
        if (!Number.isSafeInteger(n) || n < 0 || n > max) return null;
        return { value: n };
      }
      case 'mac':
        parseMac(t);
        return { value: t };
      case 'ipv4':
        parseIPv4(t);
        return { value: t };
      case 'ipv6':
        parseIPv6(t);
        return { value: t };
      case 'bytes':
        return { value: parseHexBytes(t) };
      case 'string':
      case 'dnsName':
        return { value: text };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function PayloadSection() {
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
            className="mr-1 cursor-pointer rounded p-1 text-zinc-500 hover:text-fuchsia-300"
            title="Fill with random bytes"
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
