import { useEffect, useState } from 'react';
import type { Registry } from '../../core/registry';
import type { FieldSpan, SerializedPacket } from '../../core/serialize';
import type { ValidationIssue } from '../../core/validate';
import type { FieldRef } from '../../store/highlightStore';
import { bitsLabel, formatFieldValue } from '../format';
import type { InspectionMode } from '../inspectionMode';
import type { ComputedSpec, Expr, ProtocolDefinition } from '../../core/model';
import { resolveBinding } from '../../core/bindings';
// Type-only: importing the reference tables for real would pull ~80 modules
// into the eager graph. See `useProtocolReference` below.
import type { ProtocolReference } from '../../protocols/refs/types';

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

/**
 * The protocol's first specification reference, fetched on demand.
 *
 * `referencesFor` reads a glob of ~80 reference modules. Importing it here
 * statically put every one of them in the initial download — the inspector is
 * part of the builder's eager graph — to render a single citation that only
 * appears once a field has been selected. Loading it when a field is actually
 * inspected keeps it out of the bytes every visitor pays for.
 *
 * State is keyed by protocol id rather than cleared on change, so switching
 * fields never renders the previous protocol's citation and the effect never
 * has to call setState synchronously.
 */
function useProtocolReference(def: ProtocolDefinition | undefined): ProtocolReference | undefined {
  const [loaded, setLoaded] = useState<{ id: string; reference?: ProtocolReference }>();

  useEffect(() => {
    if (!def) return;
    let cancelled = false;
    void import('../../protocols/refs').then(({ referencesFor }) => {
      if (!cancelled) {
        setLoaded({ id: def.id, reference: referencesFor(def.id, def.references)[0] });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [def]);

  return def && loaded?.id === def.id ? loaded.reference : undefined;
}

/** Compact details for the click-locked field in the synchronized packet views. */
export default function FieldInspector({
  packet,
  registry,
  selected,
  validation,
  mode,
}: {
  packet: SerializedPacket;
  registry: Registry;
  selected: FieldRef;
  validation: ValidationIssue[];
  mode: InspectionMode;
}) {
  const payload = selected.layerUid === '__payload__';
  const layout = packet.layers.find((layer) => layer.uid === selected.layerUid);
  const def = layout ? registry.get(layout.protocolId) : undefined;
  const field = def?.fields.find((candidate) => candidate.id === selected.fieldId);
  const span = packet.spans.find(
    (candidate) =>
      candidate.layerUid === selected.layerUid && candidate.fieldId === selected.fieldId,
  );
  // Called before the early return so the hook order stays unconditional.
  const reference = useProtocolReference(def);
  if (!payload && (!layout || !def || !field || !span)) return null;

  const range = payload
    ? { start: packet.payloadOffset, end: packet.bytes.length - 1 }
    : spanByteRange(span!);
  const raw = packet.bytes.slice(range.start, range.end + 1);
  const layerIndex = layout ? packet.layers.indexOf(layout) : -1;
  const issueMessages = [
    ...packet.issues
      .filter((issue) => issue.layerUid === null || issue.layerUid === selected.layerUid)
      .map((issue) => issue.message),
    ...validation
      .filter(
        (issue) =>
          (issue.layerIndex === -1 || issue.layerIndex === layerIndex) &&
          (issue.fieldId === undefined || issue.fieldId === selected.fieldId),
      )
      .map((issue) => issue.reference ? `${issue.message} ${issue.reference}` : issue.message),
  ];
  const enumTable = field?.enumRef ? registry.getEnum(field.enumRef) : undefined;
  const value = field ? formatFieldValue(field, span!.value, enumTable) : null;
  const provenance = field?.computed
    ? computationProvenance(
        field.computed,
        def!,
        layout ? packet.layers[packet.layers.indexOf(layout) + 1] : undefined,
        registry,
      )
    : null;

  return (
    <section
      aria-label="Selected field"
      className="border-b border-zinc-800 bg-zinc-900/95 px-3 py-2 text-[11px] text-zinc-400"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <strong className="text-[12px] text-zinc-200">
          {payload ? 'Payload' : `${def!.name} · ${field!.name}`}
        </strong>
        {!payload && <span className="font-mono text-zinc-300">{value}</span>}
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
      {mode === 'deep' && <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 font-mono">
        <dt className="text-zinc-600">Range</dt>
        <dd>
          bytes {range.start}–{range.end}
          {!payload && ` · bits ${span!.bitOffset}–${span!.bitOffset + span!.bitLength - 1}`}
        </dd>
        <dt className="text-zinc-600">Size</dt>
        <dd>{payload ? `${raw.length} bytes` : bitsLabel(span!.bitLength)}</dd>
        <dt className="text-zinc-600">Raw</dt>
        <dd className="break-all">{hexBytes(raw) || '—'}</dd>
        {provenance && <><dt className="text-zinc-600">Source</dt><dd>{provenance}</dd></>}
      </dl>}
      {mode === 'deep' && span?.calculation && (
        <details
          open
          className="mt-2 rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1.5"
        >
          <summary className="cursor-pointer font-medium text-zinc-300">
            Calculation trace
          </summary>
          <dl className="mt-1.5 grid grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono">
            {span.calculation.pinnedValue !== undefined && (
              <>
                <dt className="text-amber-300">Pinned wire value</dt>
                <dd>{formatTraceValue(span.calculation.pinnedValue)}</dd>
              </>
            )}
            <dt className="text-zinc-500">
              {span.calculation.pinnedValue === undefined ? 'Result' : 'Calculated value'}
            </dt>
            <dd>{formatTraceValue(span.calculation.result)}</dd>
            {span.calculation.steps.map((step, index) => (
              <div key={`${step.label}-${index}`} className="contents">
                <dt className="text-zinc-500">{step.label}</dt>
                <dd className="break-all">{step.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {mode !== 'compact' && (
        <p className="mt-1 leading-relaxed">
          {payload ? 'Opaque bytes carried after the innermost protocol header.' : field?.description || 'No field description is available.'}
        </p>
      )}
      {mode === 'deep' && reference && (
        <p className="mt-1">
          {reference.url ? (
            <a
              href={reference.url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-cyan-400 hover:underline"
            >
              {reference.name}
            </a>
          ) : (
            reference.name
          )}
        </p>
      )}
      {mode !== 'compact' && issueMessages.length > 0 && (
        <ul className="mt-1 text-amber-300">
          {issueMessages.map((message, index) => (
            <li key={`${message}-${index}`}>{message}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatTraceValue(value: number): string {
  return `${value} (0x${value.toString(16)})`;
}

function expressionLabel(expr: Expr): string {
  switch (expr.kind) {
    case 'const': return String(expr.value);
    case 'field': return expr.fieldId;
    case 'payloadBytes': return 'payload bytes';
    case 'headerBytes': return 'header bytes';
    case 'binop': return `(${expressionLabel(expr.left)} ${expr.op} ${expressionLabel(expr.right)})`;
  }
}

function computationProvenance(
  spec: ComputedSpec,
  outer: NonNullable<ReturnType<Registry['get']>>,
  next: SerializedPacket['layers'][number] | undefined,
  registry: Registry,
): string {
  if (spec.kind === 'expr') return `Expression: ${expressionLabel(spec.expr)}`;
  if (spec.kind === 'checksum') {
    const pseudo = spec.pseudoHeader ? ` with ${spec.pseudoHeader} pseudo-header` : '';
    return `${spec.algorithm} over ${spec.scope === 'header' ? 'this header' : 'this header and payload'}${pseudo}`;
  }
  const inner = next ? registry.get(next.protocolId) : undefined;
  const binding = inner ? resolveBinding(outer, inner) : null;
  if (!binding) return 'Binding selector; no following layer currently supplies a value.';
  const value = binding.claim.value === undefined ? '' : ` = ${binding.claim.value} (0x${binding.claim.value.toString(16)})`;
  return `${binding.namespace.displayName}${value}, selected by ${inner!.name}${binding.claim.conventional ? ' (conventional)' : ''}`;
}
