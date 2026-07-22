import type { ProtocolReference, ProtocolReferences } from './types';
import { referenceFromName } from './sources';

const modules = import.meta.glob('./*.[0-9].ts', {
  eager: true,
  import: 'default',
}) as Record<string, ProtocolReferences>;

const byProtocol = new Map<string, ProtocolReference[]>();
for (const [path, references] of Object.entries(modules).sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  if (!Array.isArray(references)) continue;
  const protocolId = path.match(/\/([^/]+)\.[^.]+\.ts$/)?.[1];
  if (!protocolId) continue;
  const merged = byProtocol.get(protocolId) ?? [];
  merged.push(...references);
  byProtocol.set(protocolId, merged);
}

/**
 * Full references contributed by every `refs/<protocol-id>.<suffix>.ts` file.
 * Legacy name-only references remain visible for imported/custom protocols.
 */
export function referencesFor(
  protocolId: string,
  fallbackNames: readonly string[] = [],
): ProtocolReference[] {
  const linked = byProtocol.get(protocolId) ?? [];
  const names = new Set(linked.map(({ name }) => name));
  return [
    ...linked,
    ...fallbackNames.filter((name) => !names.has(name)).map(referenceFromName),
  ];
}

export type { ProtocolReference, ProtocolReferences } from './types';
