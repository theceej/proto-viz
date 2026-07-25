import { create } from 'zustand';
import type { Capture } from '../core/capture';
import { EMPTY_FILTER, type CaptureFilter } from '../core/captureFilter';

/**
 * The open capture and everything the viewer is currently pointing at.
 *
 * This lives in a store rather than in the page so that stepping out to
 * Packet Comparison and back does not discard a capture the user has already
 * loaded, filtered, and scrolled — re-picking the file every time would make
 * the "send two packets to compare" workflow unusable.
 *
 * Nothing here is persisted: capture files can be large and are often
 * sensitive, so an open capture lasts exactly as long as the tab.
 */
interface CaptureState {
  capture: Capture | null;
  /** Packet number (1-based, as in the file) of the selected row. */
  selected: number | null;
  filter: CaptureFilter;
  /** Flow key when the list is narrowed to one conversation. */
  flowKey: string | null;
  setCapture(capture: Capture): void;
  select(packetNumber: number | null): void;
  setFilter(filter: CaptureFilter): void;
  setFlowKey(key: string | null): void;
  close(): void;
}

export const useCaptureStore = create<CaptureState>((set) => ({
  capture: null,
  selected: null,
  filter: EMPTY_FILTER,
  flowKey: null,

  setCapture: (capture) =>
    set({
      capture,
      // A fresh file starts unfiltered on its first packet.
      selected: capture.packets[0]?.number ?? null,
      filter: EMPTY_FILTER,
      flowKey: null,
    }),

  select: (packetNumber) => set({ selected: packetNumber }),
  setFilter: (filter) => set({ filter }),
  setFlowKey: (flowKey) => set({ flowKey }),
  close: () => set({ capture: null, selected: null, filter: EMPTY_FILTER, flowKey: null }),
}));
