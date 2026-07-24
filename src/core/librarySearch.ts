import type { ProtocolDefinition } from './model';
import type { ProtocolReference } from '../protocols/refs';

export type LibrarySearchResultKind = 'protocol' | 'field' | 'assignment' | 'reference';

export interface LibrarySearchResult {
  key: string;
  kind: LibrarySearchResultKind;
  protocolId: string;
  protocolName: string;
  title: string;
  detail: string;
  fieldId?: string;
  score: number;
}

interface SearchEntry extends Omit<LibrarySearchResult, 'score'> {
  text: string;
}

export interface LibrarySearchIndex {
  search(query: string, limit?: number): LibrarySearchResult[];
}

type ReferenceResolver = (
  protocolId: string,
  fallbackNames?: readonly string[],
) => ProtocolReference[];

const KIND_WEIGHT: Record<LibrarySearchResultKind, number> = {
  assignment: 40,
  field: 30,
  reference: 20,
  protocol: 10,
};

/**
 * Build an immutable search index. Rebuilding is cheap for the current library,
 * and means custom protocols and reference fallbacks are included automatically.
 */
export function createLibrarySearchIndex(
  protocols: readonly ProtocolDefinition[],
  resolveReferences: ReferenceResolver,
): LibrarySearchIndex {
  const namespaceNames = new Map<string, Set<string>>();
  for (const protocol of protocols) {
    for (const namespace of protocol.providesNamespaces) {
      const names = namespaceNames.get(namespace.id) ?? new Set<string>();
      names.add(namespace.displayName);
      namespaceNames.set(namespace.id, names);
    }
  }

  const entries: SearchEntry[] = [];
  for (const protocol of protocols) {
    const namespaceText = protocol.providesNamespaces
      .flatMap((namespace) => [namespace.id, namespace.displayName])
      .join(' ');
    entries.push({
      key: `protocol:${protocol.id}`,
      kind: 'protocol',
      protocolId: protocol.id,
      protocolName: protocol.name,
      title: protocol.name,
      detail: protocol.fullName ?? protocol.description ?? protocol.id,
      text: [
        protocol.id,
        protocol.name,
        protocol.fullName,
        protocol.description,
        protocol.notes,
        namespaceText,
      ].join(' '),
    });

    for (const field of protocol.fields) {
      entries.push({
        key: `field:${protocol.id}:${field.id}`,
        kind: 'field',
        protocolId: protocol.id,
        protocolName: protocol.name,
        fieldId: field.id,
        title: field.name,
        detail: `${protocol.name} field · ${field.id}${field.description ? ` · ${field.description}` : ''}`,
        text: [protocol.id, protocol.name, field.id, field.name, field.description].join(' '),
      });
    }

    for (const [index, claim] of protocol.encapsulations.entries()) {
      if (claim.value === undefined) continue;
      const names = [...(namespaceNames.get(claim.namespaceId) ?? [])];
      const namespaceLabel = names[0] ?? claim.namespaceId;
      const decimal = String(claim.value);
      const hexadecimal = `0x${claim.value.toString(16)}`;
      entries.push({
        key: `assignment:${protocol.id}:${claim.namespaceId}:${claim.value}:${index}`,
        kind: 'assignment',
        protocolId: protocol.id,
        protocolName: protocol.name,
        title: `${namespaceLabel} ${decimal}`,
        detail: `${protocol.name} assignment · ${hexadecimal}`,
        text: [
          protocol.id,
          protocol.name,
          claim.namespaceId,
          namespaceLabel,
          ...names,
          decimal,
          hexadecimal,
          numericToken(claim.value),
        ].join(' '),
      });
    }

    for (const [index, reference] of resolveReferences(
      protocol.id,
      protocol.references,
    ).entries()) {
      entries.push({
        key: `reference:${protocol.id}:${index}:${reference.name}`,
        kind: 'reference',
        protocolId: protocol.id,
        protocolName: protocol.name,
        title: reference.name,
        detail: `${protocol.name} reference`,
        text: [protocol.id, protocol.name, reference.name].join(' '),
      });
    }
  }

  return {
    search(query, limit = 80) {
      const normalizedQuery = normalize(query);
      const tokens = searchTokens(query);
      if (!normalizedQuery || tokens.length === 0) return [];
      return entries
        .flatMap((entry): LibrarySearchResult[] => {
          const normalizedText = normalize(entry.text);
          if (!tokens.every((token) => normalizedText.includes(token))) return [];
          const normalizedTitle = normalize(entry.title);
          let score = KIND_WEIGHT[entry.kind];
          if (normalizedTitle === normalizedQuery) score += 100;
          else if (normalizedTitle.startsWith(normalizedQuery)) score += 60;
          else if (normalizedText.includes(normalizedQuery)) score += 30;
          score += tokens.reduce(
            (total, token) => total + (normalizedTitle.includes(token) ? 8 : 2),
            0,
          );
          if (entry.kind === 'assignment' && tokens.some((token) => token.startsWith('#'))) {
            score += 50;
          }
          return [
            {
              key: entry.key,
              kind: entry.kind,
              protocolId: entry.protocolId,
              protocolName: entry.protocolName,
              title: entry.title,
              detail: entry.detail,
              fieldId: entry.fieldId,
              score,
            },
          ];
        })
        .sort(
          (a, b) =>
            b.score - a.score ||
            a.protocolName.localeCompare(b.protocolName, 'en', { sensitivity: 'base' }) ||
            a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }),
        )
        .slice(0, limit);
    },
  };
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/0x[0-9a-f]+|\b\d+\b/g, (number) => {
      const value = number.startsWith('0x')
        ? Number.parseInt(number.slice(2), 16)
        : Number.parseInt(number, 10);
      return Number.isSafeInteger(value) ? ` ${numericToken(value)} ` : number;
    })
    .replace(/[^a-z0-9#]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function searchTokens(query: string): string[] {
  return [...new Set(normalize(query).split(' ').filter(Boolean))];
}

function numericToken(value: number): string {
  return `#${value}`;
}
