import { create } from 'zustand';
import { newLayer, type FieldValue, type LayerInstance } from '../core/model';

interface StackSnapshot {
  layers: LayerInstance[];
  trailingPayload: Uint8Array;
}

interface StackState extends StackSnapshot {
  canUndo: boolean;
  canRedo: boolean;
  addLayer(protocolId: string): void;
  insertLayer(protocolId: string, index: number): void;
  removeLayer(uid: string): void;
  moveLayer(fromIndex: number, toIndex: number): void;
  setOverride(uid: string, fieldId: string, value: FieldValue): void;
  clearOverride(uid: string, fieldId: string): void;
  pinField(uid: string, fieldId: string, value: FieldValue): void;
  unpinField(uid: string, fieldId: string): void;
  setPayload(bytes: Uint8Array): void;
  setStack(protocolIds: string[], payload?: Uint8Array): void;
  /** Replace the stack with fully-specified layers (fresh uids are assigned). */
  restoreStack(
    layers: Pick<LayerInstance, 'protocolId' | 'overrides' | 'pinned'>[],
    payload?: Uint8Array,
  ): void;
  /** Replace the stack with already-constructed layer instances (random stacks). */
  replaceLayers(layers: LayerInstance[], payload?: Uint8Array): void;
  clear(): void;
  undo(): void;
  redo(): void;
  clearHistory(): void;
}

const HISTORY_LIMIT = 100;
const COALESCE_MS = 1_000;
let past: StackSnapshot[] = [];
let future: StackSnapshot[] = [];
let lastCoalesce: { key: string; at: number } | null = null;

const cloneValue = (value: FieldValue): FieldValue =>
  value instanceof Uint8Array ? new Uint8Array(value) : value;

const cloneSnapshot = (snapshot: StackSnapshot): StackSnapshot => ({
  layers: snapshot.layers.map((layer) => ({
    ...layer,
    overrides: Object.fromEntries(
      Object.entries(layer.overrides).map(([key, value]) => [key, cloneValue(value)]),
    ),
    pinned: [...layer.pinned],
  })),
  trailingPayload: new Uint8Array(snapshot.trailingPayload),
});

const updateLayer = (
  layers: LayerInstance[],
  uid: string,
  fn: (layer: LayerInstance) => LayerInstance,
) => layers.map((layer) => (layer.uid === uid ? fn(layer) : layer));

export const useStackStore = create<StackState>((set, get) => {
  const commit = (next: StackSnapshot, coalesceKey?: string) => {
    const now = Date.now();
    const coalescing =
      coalesceKey !== undefined &&
      lastCoalesce?.key === coalesceKey &&
      now - lastCoalesce.at <= COALESCE_MS;
    if (!coalescing) {
      past.push(cloneSnapshot(get()));
      if (past.length > HISTORY_LIMIT) past.shift();
    }
    future = [];
    lastCoalesce = coalesceKey ? { key: coalesceKey, at: now } : null;
    set({ ...cloneSnapshot(next), canUndo: past.length > 0, canRedo: false });
  };

  return {
    layers: [newLayer('ethernet'), newLayer('ipv4'), newLayer('tcp')],
    trailingPayload: new Uint8Array(0),
    canUndo: false,
    canRedo: false,

    addLayer: (protocolId) =>
      commit({ ...get(), layers: [...get().layers, newLayer(protocolId)] }),

    insertLayer: (protocolId, index) => {
      const layers = [...get().layers];
      layers.splice(index, 0, newLayer(protocolId));
      commit({ ...get(), layers });
    },

    removeLayer: (uid) => {
      if (!get().layers.some((layer) => layer.uid === uid)) return;
      commit({ ...get(), layers: get().layers.filter((layer) => layer.uid !== uid) });
    },

    moveLayer: (fromIndex, toIndex) => {
      if (fromIndex < 0 || fromIndex >= get().layers.length || toIndex < 0 || toIndex >= get().layers.length || fromIndex === toIndex) return;
      const layers = [...get().layers];
      const [moved] = layers.splice(fromIndex, 1);
      layers.splice(toIndex, 0, moved!);
      commit({ ...get(), layers });
    },

    setOverride: (uid, fieldId, value) =>
      commit(
        {
          ...get(),
          layers: updateLayer(get().layers, uid, (layer) => ({
            ...layer,
            overrides: { ...layer.overrides, [fieldId]: cloneValue(value) },
          })),
        },
        `field:${uid}:${fieldId}`,
      ),

    clearOverride: (uid, fieldId) => {
      const layers = updateLayer(get().layers, uid, (layer) => {
        const overrides = { ...layer.overrides };
        delete overrides[fieldId];
        return { ...layer, overrides, pinned: layer.pinned.filter((item) => item !== fieldId) };
      });
      commit({ ...get(), layers });
    },

    pinField: (uid, fieldId, value) =>
      commit({
        ...get(),
        layers: updateLayer(get().layers, uid, (layer) => ({
          ...layer,
          overrides: { ...layer.overrides, [fieldId]: cloneValue(value) },
          pinned: layer.pinned.includes(fieldId) ? layer.pinned : [...layer.pinned, fieldId],
        })),
      }),

    unpinField: (uid, fieldId) => {
      const layers = updateLayer(get().layers, uid, (layer) => {
        const overrides = { ...layer.overrides };
        delete overrides[fieldId];
        return { ...layer, overrides, pinned: layer.pinned.filter((item) => item !== fieldId) };
      });
      commit({ ...get(), layers });
    },

    setPayload: (bytes) =>
      commit({ ...get(), trailingPayload: new Uint8Array(bytes) }, 'payload'),

    setStack: (protocolIds, payload) =>
      commit({
        layers: protocolIds.map(newLayer),
        trailingPayload: payload ?? new Uint8Array(0),
      }),

    restoreStack: (layers, payload) =>
      commit({
        layers: layers.map((layer) => ({
          ...newLayer(layer.protocolId),
          overrides: Object.fromEntries(
            Object.entries(layer.overrides).map(([key, value]) => [key, cloneValue(value)]),
          ),
          pinned: [...layer.pinned],
        })),
        trailingPayload: payload ?? new Uint8Array(0),
      }),

    replaceLayers: (layers, payload) =>
      commit({ layers, trailingPayload: payload ?? new Uint8Array(0) }),

    clear: () => commit({ layers: [], trailingPayload: new Uint8Array(0) }),

    undo: () => {
      const previous = past.pop();
      if (!previous) return;
      future.push(cloneSnapshot(get()));
      lastCoalesce = null;
      set({ ...cloneSnapshot(previous), canUndo: past.length > 0, canRedo: true });
    },

    redo: () => {
      const next = future.pop();
      if (!next) return;
      past.push(cloneSnapshot(get()));
      lastCoalesce = null;
      set({ ...cloneSnapshot(next), canUndo: true, canRedo: future.length > 0 });
    },

    clearHistory: () => {
      past = [];
      future = [];
      lastCoalesce = null;
      set({ canUndo: false, canRedo: false });
    },
  };
});
