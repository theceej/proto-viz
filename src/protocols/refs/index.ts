import type { ProtocolReference, ProtocolReferences } from './types';
import { referenceFromName } from './sources';

const modules = import.meta.glob(['./*.[0-9]*.ts', './*.*.[0-9]*.ts'], {
  eager: true,
  import: 'default',
}) as Record<string, ProtocolReferences>;

/**
 * `<protocol-id>.<qualifier?>.<n>.ts`.
 *
 * The optional qualifier names where a set of references comes from — an
 * organisation, a deployment, a downstream fork — so several contributors can
 * add references to the same protocol without having to agree on a number
 * between them. `n` orders the files from one contributor and may be any
 * number of digits. Protocol ids contain hyphens but never dots, which is what
 * makes the qualifier unambiguous.
 */
const FILENAME = /^(?:\.\/)?([^/.]+)(?:\.([^/.]+))?\.(\d+)\.ts$/;

export interface ReferenceFilename {
  protocolId: string;
  /** Empty for the protocol's own references. */
  qualifier: string;
  index: number;
}

/** Parse a reference module's filename, or null when it is not one. */
export function parseReferenceFilename(path: string): ReferenceFilename | null {
  const match = FILENAME.exec(path);
  if (!match) return null;
  return { protocolId: match[1]!, qualifier: match[2] ?? '', index: Number(match[3]) };
}

/**
 * Unqualified files first — those are the protocol's own references — then each
 * qualifier's, in order. `n` is compared numerically, so a tenth file does not
 * sort between the first and the second.
 */
export function compareReferenceFilenames(a: ReferenceFilename, b: ReferenceFilename): number {
  return (
    a.protocolId.localeCompare(b.protocolId) ||
    a.qualifier.localeCompare(b.qualifier) ||
    a.index - b.index
  );
}

/**
 * Every reference module the glob found, so a test can check the glob and the
 * filename grammar above still agree about what counts as one.
 */
export const referenceModulePaths: readonly string[] = Object.keys(modules)
  .filter((path) => parseReferenceFilename(path))
  .map((path) => path.replace(/^\.\//, ''))
  .sort();

const found: (ReferenceFilename & { references: ProtocolReferences })[] = [];
for (const [path, references] of Object.entries(modules)) {
  if (!Array.isArray(references)) continue;
  const parsed = parseReferenceFilename(path);
  if (parsed) found.push({ ...parsed, references });
}
found.sort(compareReferenceFilenames);

const byProtocol = new Map<string, ProtocolReference[]>();
for (const { protocolId, references } of found) {
  const merged = byProtocol.get(protocolId) ?? [];
  merged.push(...references);
  byProtocol.set(protocolId, merged);
}

/**
 * Full references contributed by every `refs/<protocol-id>.<qualifier?>.<n>.ts`
 * file. Legacy name-only references remain visible for imported/custom
 * protocols.
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
