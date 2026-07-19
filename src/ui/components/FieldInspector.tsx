import type { Registry } from '../../core/registry';
import type { FieldSpan, SerializedPacket } from '../../core/serialize';
import type { ValidationIssue } from '../../core/validate';
import type { FieldRef } from '../../store/highlightStore';
import { bitsLabel, formatFieldValue } from '../format';
import { specUrl } from '../refs';

export function asciiByte(byte: number): string {
  return byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.';
}

export function spanByteRange(span: Pick<FieldSpan, 'bitOffset' | 'bitLength'>): {
  start: number;
  end: number;
} {
  return {
    start: Math.floor(span.bitOffset / 8),
    end: Math.ceil((span.bitOffset + span.bitLength) / 8) - 1,
  };
}

const hexBytes = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');

/** Compact details for the click-locked field in the synchronized packet views. */
export default function FieldInspector({
  packet,
  registry,
  selected,
  validation,
}: {
  packet: SerializedPacket;
  registry: Registry;
  selected: FieldRef;
  validation: ValidationIssue[];
}) {
  const payload = selected.layerUid === '__payload__';
  const layout = packet.layers.find((layer) => layer.uid === selected.layerUid);
  const def = layout ? registry.get(layout.protocolId) : undefined;
  const field = def?.fields.find((candidate) => candidate.id === selected.fieldId);
  const span = packet.spans.find(
    (candidate) =>
      candidate.layerUid === selected.layerUid && candidate.fieldId === selected.fieldId,
  );
  if (!payload && (!layout || !def || !field || !span)) return null;

  const range = payload
    ? { start: packet.payloadOffset, end: packet.bytes.length - 1 }
    : spanByteRange(span!);
  const raw = packet.bytes.slice(range.start, range.end + 1);
  const reference = def?.references?.[0];
  const referenceUrl = reference ? specUrl(reference) : null;
  const layerIndex = layout ? packet.layers.indexOf(layout) : -1;
  const issueMessages = [
    ...packet.issues
      .filter((issue) => issue.layerUid === null || issue.layerUid === selected.layerUid)
      .map((issue) => issue.message),
    ...validation
      .filter((issue) => issue.layerIndex === -1 || issue.layerIndex === layerIndex)
      .map((issue) => issue.message),
  ];
  const enumTable = field?.enumRef ? registry.getEnum(field.enumRef) : undefined;

  return (
    <section
      aria-label="Selected field"
      className="border-b border-zinc-800 bg-zinc-900/95 px-3 py-2 text-[11px] text-zinc-400"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <strong className="text-[12px] text-zinc-200">
          {payload ? 'Payload' : `${def!.name} · ${field!.name}`}
        </strong>
        {!payload && span!.computed && (
          <span className="rounded bg-cyan-500/10 px-1 text-cyan-300">computed</span>
        )}
        {!payload && span!.pinned && (
          <span className="rounded bg-amber-500/10 px-1 text-amber-300">pinned</span>
        )}
        <span className={issueMessages.length > 0 ? 'text-amber-300' : 'text-emerald-400'}>
          {issueMessages.length > 0
            ? `${issueMessages.length} layer issue${issueMessages.length === 1 ? '' : 's'}`
            : 'valid'}
        </span>
      </div>
      <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 font-mono">
        <dt className="text-zinc-600">Range</dt>
        <dd>
          bytes {range.start}–{range.end}
          {!payload && ` · bits ${span!.bitOffset}–${span!.bitOffset + span!.bitLength - 1}`}
        </dd>
        <dt className="text-zinc-600">Size</dt>
        <dd>{payload ? `${raw.length} bytes` : bitsLabel(span!.bitLength)}</dd>
        {!payload && (
          <>
            <dt className="text-zinc-600">Value</dt>
            <dd className="truncate" title={formatFieldValue(field!, span!.value, enumTable)}>
              {formatFieldValue(field!, span!.value, enumTable)}
            </dd>
          </>
        )}
        <dt className="text-zinc-600">Raw</dt>
        <dd className="break-all">{hexBytes(raw) || '—'}</dd>
      </dl>
      {field?.description && <p className="mt-1 leading-relaxed">{field.description}</p>}
      {reference && (
        <p className="mt-1">
          {referenceUrl ? (
            <a
              href={referenceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-cyan-400 hover:underline"
            >
              {reference}
            </a>
          ) : (
            reference
          )}
        </p>
      )}
      {issueMessages.length > 0 && (
        <ul className="mt-1 text-amber-300">
          {issueMessages.map((message, index) => (
            <li key={`${message}-${index}`}>{message}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
