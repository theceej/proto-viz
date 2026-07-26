/** IndexedDB persistence for custom protocol definitions and saved stacks. */
import { openDB, type IDBPDatabase } from 'idb';
import type { LayerInstance, ProtocolDefinition } from '../core/model';

const DB_NAME = 'proto-viz';
const PROTOCOLS = 'customProtocols';
const STACKS = 'savedStacks';
const META = 'workspaceMeta';
const REVISION_KEY = 'revision';

export type LoadResult<T> =
  | { ok: true; data: T[] }
  | { ok: false; errorName: string };

export type PersistenceResult<T> =
  | { ok: true; data: T }
  | { ok: false; errorName: string };

export type PersistenceApplyResult =
  | { ok: true; revision?: number }
  | { ok: false; errorName: string };

/** A stack snapshot as stored. Layer uids are regenerated on load. */
export interface SavedStack {
  id: string;
  name: string;
  savedAt: number;
  layers: Pick<LayerInstance, 'protocolId' | 'overrides' | 'pinned'>[];
  trailingPayload: Uint8Array;
}

/** Complete persisted data, suitable for export or restoring after a failed import. */
export interface PersistenceSnapshot {
  customProtocols: ProtocolDefinition[];
  savedStacks: SavedStack[];
  revision: number;
}

export type PersistenceCategoryUpdate<T> =
  | { mode: 'untouched' }
  | { mode: 'merge' | 'replace'; data: T[] };

/**
 * The caller resolves merge conflicts and supplies the final data for each selected category.
 * Merge and replace are retained in the plan so import review choices remain explicit.
 */
export interface PersistenceApplyPlan {
  customProtocols: PersistenceCategoryUpdate<ProtocolDefinition>;
  savedStacks: PersistenceCategoryUpdate<SavedStack>;
}

export type PersistenceStoreName = typeof PROTOCOLS | typeof STACKS;

/** Small transaction surface kept independent of IndexedDB for deterministic unit tests. */
export interface PersistenceTransactionOperations {
  clear(store: PersistenceStoreName): Promise<unknown>;
  put(store: PersistenceStoreName, value: ProtocolDefinition | SavedStack): Promise<unknown>;
  done: Promise<unknown>;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, 3, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) database.createObjectStore(PROTOCOLS, { keyPath: 'id' });
      if (oldVersion < 2) database.createObjectStore(STACKS, { keyPath: 'id' });
      if (oldVersion < 3) database.createObjectStore(META).put(0, REVISION_KEY);
    },
  });
  return dbPromise;
}

async function persistHint(): Promise<void> {
  // Ask the browser not to evict the user's data under storage pressure.
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* best effort */
  }
}

export async function readPersisted<T>(read: () => Promise<T[]>): Promise<LoadResult<T>> {
  try {
    return { ok: true, data: await read() };
  } catch (error) {
    return { ok: false, errorName: error instanceof Error ? error.name : 'UnknownError' };
  }
}

export function loadCustomProtocols(): Promise<LoadResult<ProtocolDefinition>> {
  return readPersisted(async () => (await (await db()).getAll(PROTOCOLS)) as ProtocolDefinition[]);
}

export async function saveCustomProtocol(def: ProtocolDefinition): Promise<void> {
  const transaction = (await db()).transaction([PROTOCOLS, META], 'readwrite');
  await transaction.objectStore(PROTOCOLS).put(def);
  await incrementRevision(transaction.objectStore(META));
  await transaction.done;
  await persistHint();
}

export async function deleteCustomProtocol(id: string): Promise<void> {
  const transaction = (await db()).transaction([PROTOCOLS, META], 'readwrite');
  await transaction.objectStore(PROTOCOLS).delete(id);
  await incrementRevision(transaction.objectStore(META));
  await transaction.done;
}

export function loadSavedStacks(): Promise<LoadResult<SavedStack>> {
  return readPersisted(async () => {
    const all = (await (await db()).getAll(STACKS)) as SavedStack[];
    return all.sort((a, b) => b.savedAt - a.savedAt);
  });
}

/** Read both stores from one transaction to produce a consistent, complete snapshot. */
export async function loadPersistenceSnapshot(): Promise<PersistenceResult<PersistenceSnapshot>> {
  try {
    const transaction = (await db()).transaction([PROTOCOLS, STACKS, META], 'readonly');
    const [customProtocols, savedStacks, revision] = await Promise.all([
      transaction.objectStore(PROTOCOLS).getAll() as Promise<ProtocolDefinition[]>,
      transaction.objectStore(STACKS).getAll() as Promise<SavedStack[]>,
      readRevision(transaction.objectStore(META)),
    ]);
    await transaction.done;
    return {
      ok: true,
      data: {
        customProtocols,
        savedStacks: savedStacks.sort((a, b) => b.savedAt - a.savedAt),
        revision,
      },
    };
  } catch (error) {
    return { ok: false, errorName: error instanceof Error ? error.name : 'UnknownError' };
  }
}

/** Apply all selected category replacements through an already-open transaction. */
export async function applyPersistenceTransaction(
  transaction: PersistenceTransactionOperations,
  plan: PersistenceApplyPlan,
): Promise<PersistenceApplyResult> {
  const categories: Array<
    [PersistenceStoreName, PersistenceCategoryUpdate<ProtocolDefinition | SavedStack>]
  > = [
    [PROTOCOLS, plan.customProtocols],
    [STACKS, plan.savedStacks],
  ];

  try {
    for (const [store, update] of categories) {
      if (update.mode === 'untouched') continue;
      await transaction.clear(store);
      for (const value of update.data) await transaction.put(store, value);
    }
    await transaction.done;
    return { ok: true };
  } catch (error) {
    // Observe the transaction's abort rejection as well as the failing request.
    try {
      await transaction.done;
    } catch {
      // The request error below is the more useful diagnostic.
    }
    return { ok: false, errorName: error instanceof Error ? error.name : 'UnknownError' };
  }
}

/** Atomically apply selected final category data; failures leave both stores unchanged. */
export async function applyPersistenceSnapshot(
  plan: PersistenceApplyPlan,
  expectedRevision?: number,
): Promise<PersistenceApplyResult> {
  try {
    const transaction = (await db()).transaction([PROTOCOLS, STACKS, META], 'readwrite');
    const currentRevision = await readRevision(transaction.objectStore(META));
    if (expectedRevision !== undefined && currentRevision !== expectedRevision) {
      transaction.abort();
      try { await transaction.done; } catch { /* expected abort */ }
      return { ok: false, errorName: 'WorkspaceChangedError' };
    }
    const categories: Array<[PersistenceStoreName, PersistenceCategoryUpdate<ProtocolDefinition | SavedStack>]> = [
      [PROTOCOLS, plan.customProtocols],
      [STACKS, plan.savedStacks],
    ];
    for (const [store, update] of categories) {
      if (update.mode === 'untouched') continue;
      await transaction.objectStore(store).clear();
      for (const value of update.data) await transaction.objectStore(store).put(value);
    }
    const revision = currentRevision + 1;
    await transaction.objectStore(META).put(revision, REVISION_KEY);
    await transaction.done;
    await persistHint();
    return { ok: true, revision };
  } catch (error) {
    return { ok: false, errorName: error instanceof Error ? error.name : 'UnknownError' };
  }
}

export async function saveStack(stack: SavedStack): Promise<void> {
  const transaction = (await db()).transaction([STACKS, META], 'readwrite');
  await transaction.objectStore(STACKS).put(stack);
  await incrementRevision(transaction.objectStore(META));
  await transaction.done;
  await persistHint();
}

export async function deleteSavedStack(id: string): Promise<void> {
  const transaction = (await db()).transaction([STACKS, META], 'readwrite');
  await transaction.objectStore(STACKS).delete(id);
  await incrementRevision(transaction.objectStore(META));
  await transaction.done;
}

async function readRevision(store: { get(key: string): Promise<unknown> }): Promise<number> {
  const value = await store.get(REVISION_KEY);
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

async function incrementRevision(store: { get(key: string): Promise<unknown>; put(value: number, key: string): Promise<unknown> }): Promise<number> {
  const revision = (await readRevision(store)) + 1;
  await store.put(revision, REVISION_KEY);
  return revision;
}
