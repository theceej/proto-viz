/** IndexedDB persistence for custom protocol definitions. */
import { openDB, type IDBPDatabase } from 'idb';
import type { ProtocolDefinition } from '../core/model';

const DB_NAME = 'proto-viz';
const STORE = 'customProtocols';

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, 1, {
    upgrade(database) {
      database.createObjectStore(STORE, { keyPath: 'id' });
    },
  });
  return dbPromise;
}

export async function loadCustomProtocols(): Promise<ProtocolDefinition[]> {
  try {
    return (await (await db()).getAll(STORE)) as ProtocolDefinition[];
  } catch {
    return [];
  }
}

export async function saveCustomProtocol(def: ProtocolDefinition): Promise<void> {
  await (await db()).put(STORE, def);
  // Ask the browser not to evict the user's protocol library under pressure.
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* best effort */
  }
}

export async function deleteCustomProtocol(id: string): Promise<void> {
  await (await db()).delete(STORE, id);
}
