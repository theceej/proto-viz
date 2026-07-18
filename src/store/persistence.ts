/** IndexedDB persistence for custom protocol definitions and saved stacks. */
import { openDB, type IDBPDatabase } from 'idb';
import type { LayerInstance, ProtocolDefinition } from '../core/model';

const DB_NAME = 'proto-viz';
const PROTOCOLS = 'customProtocols';
const STACKS = 'savedStacks';

export type LoadResult<T> =
  | { ok: true; data: T[] }
  | { ok: false; errorName: string };

/** A stack snapshot as stored. Layer uids are regenerated on load. */
export interface SavedStack {
  id: string;
  name: string;
  savedAt: number;
  layers: Pick<LayerInstance, 'protocolId' | 'overrides' | 'pinned'>[];
  trailingPayload: Uint8Array;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, 2, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) database.createObjectStore(PROTOCOLS, { keyPath: 'id' });
      if (oldVersion < 2) database.createObjectStore(STACKS, { keyPath: 'id' });
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
  await (await db()).put(PROTOCOLS, def);
  await persistHint();
}

export async function deleteCustomProtocol(id: string): Promise<void> {
  await (await db()).delete(PROTOCOLS, id);
}

export function loadSavedStacks(): Promise<LoadResult<SavedStack>> {
  return readPersisted(async () => {
    const all = (await (await db()).getAll(STACKS)) as SavedStack[];
    return all.sort((a, b) => b.savedAt - a.savedAt);
  });
}

export async function saveStack(stack: SavedStack): Promise<void> {
  await (await db()).put(STACKS, stack);
  await persistHint();
}

export async function deleteSavedStack(id: string): Promise<void> {
  await (await db()).delete(STACKS, id);
}
