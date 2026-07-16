import { create } from 'zustand';

export interface FieldRef {
  layerUid: string;
  fieldId: string;
}

interface HighlightState {
  hovered: FieldRef | null;
  /** Click-pinned highlight; survives mouse-out. */
  locked: FieldRef | null;
  setHovered(ref: FieldRef | null): void;
  toggleLocked(ref: FieldRef): void;
}

export const useHighlightStore = create<HighlightState>((set) => ({
  hovered: null,
  locked: null,
  setHovered: (ref) => set({ hovered: ref }),
  toggleLocked: (ref) =>
    set((s) =>
      s.locked && s.locked.layerUid === ref.layerUid && s.locked.fieldId === ref.fieldId
        ? { locked: null }
        : { locked: ref },
    ),
}));

export function isActive(ref: FieldRef | null, layerUid: string, fieldId: string): boolean {
  return ref !== null && ref.layerUid === layerUid && ref.fieldId === fieldId;
}
