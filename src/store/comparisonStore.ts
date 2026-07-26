import { create } from 'zustand';
import type { SerializedPacket } from '../core/serialize';

export interface ComparisonPacket {
  id: number;
  label: string;
  packet: SerializedPacket;
}

export type ComparisonPacketSnapshot = Pick<ComparisonPacket, 'label' | 'packet'>;

interface ComparisonState {
  packets: ComparisonPacket[];
  addPacket(packet: SerializedPacket, label: string): void;
  replacePackets(packets: ComparisonPacketSnapshot[]): void;
  mergePackets(packets: ComparisonPacketSnapshot[]): void;
  removePacket(id: number): void;
  clear(): void;
}

let nextId = 1;

function restorePackets(packets: ComparisonPacketSnapshot[]): ComparisonPacket[] {
  return packets.slice(-2).map(({ label, packet }) => ({ id: nextId++, label, packet }));
}

export const useComparisonStore = create<ComparisonState>((set) => ({
  packets: [],
  addPacket: (packet, label) =>
    set((state) => ({
      // Keep packet snapshots independent of subsequent Builder edits. A third
      // selection replaces the oldest, matching the two comparison slots.
      packets: [...state.packets.slice(-1), { id: nextId++, label, packet }],
    })),
  replacePackets: (packets) => set({ packets: restorePackets(packets) }),
  mergePackets: (packets) =>
    set((state) => ({
      packets: [...state.packets, ...restorePackets(packets)].slice(-2),
    })),
  removePacket: (id) => set((state) => ({ packets: state.packets.filter((item) => item.id !== id) })),
  clear: () => set({ packets: [] }),
}));
