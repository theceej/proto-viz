import { create } from 'zustand';
import type { SerializedPacket } from '../core/serialize';

export interface ComparisonPacket {
  id: number;
  label: string;
  packet: SerializedPacket;
}

interface ComparisonState {
  packets: ComparisonPacket[];
  addPacket(packet: SerializedPacket, label: string): void;
  removePacket(id: number): void;
  clear(): void;
}

let nextId = 1;

export const useComparisonStore = create<ComparisonState>((set) => ({
  packets: [],
  addPacket: (packet, label) =>
    set((state) => ({
      // Keep packet snapshots independent of subsequent Builder edits. A third
      // selection replaces the oldest, matching the two comparison slots.
      packets: [...state.packets.slice(-1), { id: nextId++, label, packet }],
    })),
  removePacket: (id) => set((state) => ({ packets: state.packets.filter((item) => item.id !== id) })),
  clear: () => set({ packets: [] }),
}));
