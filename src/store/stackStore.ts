import { create } from 'zustand';
import { newLayer, type FieldValue, type LayerInstance } from '../core/model';

interface StackState {
  layers: LayerInstance[];
  trailingPayload: Uint8Array;
  addLayer(protocolId: string): void;
  removeLayer(uid: string): void;
  moveLayer(fromIndex: number, toIndex: number): void;
  setOverride(uid: string, fieldId: string, value: FieldValue): void;
  clearOverride(uid: string, fieldId: string): void;
  pinField(uid: string, fieldId: string, value: FieldValue): void;
  unpinField(uid: string, fieldId: string): void;
  setPayload(bytes: Uint8Array): void;
  setStack(protocolIds: string[], payload?: Uint8Array): void;
  clear(): void;
}

const updateLayer = (
  layers: LayerInstance[],
  uid: string,
  fn: (l: LayerInstance) => LayerInstance,
) => layers.map((l) => (l.uid === uid ? fn(l) : l));

export const useStackStore = create<StackState>((set) => ({
  layers: [newLayer('ethernet'), newLayer('ipv4'), newLayer('tcp')],
  trailingPayload: new Uint8Array(0),

  addLayer: (protocolId) => set((s) => ({ layers: [...s.layers, newLayer(protocolId)] })),

  removeLayer: (uid) => set((s) => ({ layers: s.layers.filter((l) => l.uid !== uid) })),

  moveLayer: (fromIndex, toIndex) =>
    set((s) => {
      const layers = [...s.layers];
      const [moved] = layers.splice(fromIndex, 1);
      if (!moved) return s;
      layers.splice(toIndex, 0, moved);
      return { layers };
    }),

  setOverride: (uid, fieldId, value) =>
    set((s) => ({
      layers: updateLayer(s.layers, uid, (l) => ({
        ...l,
        overrides: { ...l.overrides, [fieldId]: value },
      })),
    })),

  clearOverride: (uid, fieldId) =>
    set((s) => ({
      layers: updateLayer(s.layers, uid, (l) => {
        const overrides = { ...l.overrides };
        delete overrides[fieldId];
        return { ...l, overrides, pinned: l.pinned.filter((p) => p !== fieldId) };
      }),
    })),

  pinField: (uid, fieldId, value) =>
    set((s) => ({
      layers: updateLayer(s.layers, uid, (l) => ({
        ...l,
        overrides: { ...l.overrides, [fieldId]: value },
        pinned: l.pinned.includes(fieldId) ? l.pinned : [...l.pinned, fieldId],
      })),
    })),

  unpinField: (uid, fieldId) =>
    set((s) => ({
      layers: updateLayer(s.layers, uid, (l) => {
        const overrides = { ...l.overrides };
        delete overrides[fieldId];
        return { ...l, overrides, pinned: l.pinned.filter((p) => p !== fieldId) };
      }),
    })),

  setPayload: (bytes) => set({ trailingPayload: bytes }),

  setStack: (protocolIds, payload) =>
    set({
      layers: protocolIds.map(newLayer),
      trailingPayload: payload ?? new Uint8Array(0),
    }),

  clear: () => set({ layers: [], trailingPayload: new Uint8Array(0) }),
}));
