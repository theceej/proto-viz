/**
 * Turn a parsed diagram into an editable ProtocolDefinition draft, inferring
 * field types from names/widths. Every inference is surfaced in the review
 * UI — nothing is guessed silently.
 */
import type { FieldDef, FieldType, LayerHint, ProtocolDefinition } from '../core/model';
import type { DiagramParse, ParsedField } from './diagram';

export interface DraftField {
  id: string;
  name: string;
  bitLength: number;
  type: FieldType;
  variable: boolean;
  flags: string[];
  inference?: string;
}

export interface ProtocolDraft {
  name: string;
  fields: DraftField[];
  warnings: string[];
  confidence: number;
}

export function buildDraft(parse: DiagramParse, suggestedName: string): ProtocolDraft {
  const seen = new Set<string>();
  const fields = parse.fields.map((f) => {
    const inferred = inferType(f);
    let id = camelCase(f.name) || 'field';
    while (seen.has(id)) id = `${id}X`;
    seen.add(id);
    return {
      id,
      name: f.name,
      bitLength: f.bitLength,
      type: inferred.type,
      variable: f.variable,
      flags: f.flags,
      inference: inferred.reason,
    };
  });
  return {
    name: suggestedName,
    fields,
    warnings: parse.warnings,
    confidence: parse.confidence,
  };
}

function inferType(f: ParsedField): { type: FieldType; reason?: string } {
  const n = f.name.toLowerCase();
  if (f.variable) return { type: 'bytes', reason: 'variable-length marker in diagram' };
  const addressLike = /\baddr(ess)?\b|\bsource\b|\bdestination\b/.test(n);
  if (f.bitLength === 32 && addressLike)
    return { type: 'ipv4', reason: '32-bit field named like an address' };
  if (f.bitLength === 128 && addressLike)
    return { type: 'ipv6', reason: '128-bit field named like an address' };
  if (f.bitLength === 48 && (addressLike || n.includes('mac') || n.includes('hardware')))
    return { type: 'mac', reason: '48-bit field named like a hardware address' };
  if (f.bitLength > 64) return { type: 'bytes', reason: 'wider than 64 bits' };
  return { type: 'uint' };
}

export function camelCase(s: string): string {
  const words = s
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '';
  return words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase()))
    .join('');
}

export function kebabCase(s: string): string {
  return (
    s
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'custom-protocol'
  );
}

/** Assemble the final ProtocolDefinition from the reviewed draft. */
export function draftToDefinition(
  draft: ProtocolDraft,
  meta: {
    id: string;
    name: string;
    layerHint: LayerHint;
    description?: string;
    references?: string[];
    encapsulations: { namespaceId: string; value?: number }[];
  },
): ProtocolDefinition {
  const fields: FieldDef[] = draft.fields.map((f) => ({
    id: f.id,
    name: f.name,
    type: f.type,
    bitLength: f.variable ? ('auto' as const) : f.bitLength,
    default: undefined,
    description: f.inference ? `Imported (${f.inference}).` : undefined,
  }));
  return {
    id: meta.id,
    name: meta.name,
    layerHint: meta.layerHint,
    fields,
    providesNamespaces: [],
    encapsulations: meta.encapsulations,
    source: 'custom',
    description: meta.description,
    references: meta.references,
  };
}
