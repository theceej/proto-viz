import type { StackInstance } from '../../../core/model';

/**
 * The packet a lab tab is working on, and where it came from.
 *
 * Both tabs used to read the Stack Builder directly, which made them two
 * unrelated tools that happened to sit next to each other. Naming the input
 * instead is what lets them compose: fragmenting produces packets, fuzzing
 * consumes one, and vice versa, so a fragment can be corrupted and a corrupted
 * packet can be fragmented. "Fuzz the third fragment of this datagram and see
 * whether reassembly still works" is a real question, and it is only askable
 * once the two labs can hand packets to each other.
 *
 * `origin` exists so the UI can say where a packet came from — a lab working
 * on something other than the builder's current stack has to be obvious about
 * it, or the results look like nonsense.
 */
export interface LabSource {
  /** Shown in the source chip, e.g. "Fragment 2 of 4" or "Fuzzed: seed 4242". */
  label: string;
  origin: 'builder' | 'fragmentation' | 'fuzzing';
  stack: StackInstance;
}

export const LAB_TABS = ['fragmentation', 'fuzzing'] as const;
export type LabTab = (typeof LAB_TABS)[number];

export const isLabTab = (value: string | undefined): value is LabTab =>
  value !== undefined && (LAB_TABS as readonly string[]).includes(value);

/** What each tab is called, and the route segment that opens it. */
export const TAB_COPY: Record<LabTab, { label: string; blurb: string }> = {
  fragmentation: {
    label: 'Fragmentation',
    blurb: 'Split one IP datagram, disturb arrival order, and watch reassembly.',
  },
  fuzzing: {
    label: 'Fuzzing',
    blurb: 'Corrupt a packet from a seed and see what a receiver makes of it.',
  },
};

/** The tab a hand-off from `from` is destined for. */
export const otherTab = (from: LabTab): LabTab =>
  from === 'fragmentation' ? 'fuzzing' : 'fragmentation';

/** Props every lab tab takes, so the shell drives both identically. */
export interface LabTabProps {
  source: LabSource;
  /** Send a packet to the other tab, switching to it. */
  onHandoff: (source: LabSource) => void;
}
