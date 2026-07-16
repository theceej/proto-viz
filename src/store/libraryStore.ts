import { create } from 'zustand';
import type { ProtocolDefinition } from '../core/model';
import type { Registry } from '../core/registry';
import { createBuiltinRegistry } from '../protocols';

interface LibraryState {
  custom: ProtocolDefinition[];
  registry: Registry;
  addCustom(def: ProtocolDefinition): void;
  removeCustom(id: string): void;
  setCustom(defs: ProtocolDefinition[]): void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  custom: [],
  registry: createBuiltinRegistry(),
  addCustom: (def) =>
    set((s) => {
      const custom = [...s.custom.filter((c) => c.id !== def.id), def];
      return { custom, registry: createBuiltinRegistry(custom) };
    }),
  removeCustom: (id) =>
    set((s) => {
      const custom = s.custom.filter((c) => c.id !== id);
      return { custom, registry: createBuiltinRegistry(custom) };
    }),
  setCustom: (defs) => set({ custom: defs, registry: createBuiltinRegistry(defs) }),
}));
