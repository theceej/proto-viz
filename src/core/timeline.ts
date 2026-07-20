/**
 * Scenario timelines: turn a scenario's generated packet sequence into a
 * playable timeline — a list of steps, each with its serialized packet and
 * validation, plus the two endpoints the exchange runs between and the
 * direction of every message.
 *
 * Direction and endpoints are inferred from the packets themselves (the
 * outermost network-layer source/destination address), so this stays generic
 * across scenarios rather than depending on each generator to describe them.
 */
import type { StackInstance } from './model';
import type { Registry } from './registry';
import type { PacketPlan } from './scenarios';
import { serializeStack, type SerializedPacket } from './serialize';
import { validateStack, type ValidationIssue } from './validate';

/**
 * Address-bearing layers in the order we prefer to read a packet's identity
 * from: network layer first (the real path), then ARP's protocol addresses,
 * then the link layer as a last resort.
 */
const ADDRESS_LAYERS: { protocolId: string; src: string; dst: string }[] = [
  { protocolId: 'ipv4', src: 'src', dst: 'dst' },
  { protocolId: 'ipv6', src: 'src', dst: 'dst' },
  { protocolId: 'arp', src: 'spa', dst: 'tpa' },
  { protocolId: 'ethernet', src: 'src', dst: 'dst' },
  { protocolId: 'ethernet-8023', src: 'src', dst: 'dst' },
];

/** The source/destination identity of a packet, or null if none is readable. */
function packetEndpoints(packet: SerializedPacket): { src: string; dst: string } | null {
  for (const spec of ADDRESS_LAYERS) {
    const layer = packet.layers.find((l) => l.protocolId === spec.protocolId);
    if (!layer) continue;
    const spans = packet.spans.filter((s) => s.layerUid === layer.uid);
    const src = spans.find((s) => s.fieldId === spec.src)?.value;
    const dst = spans.find((s) => s.fieldId === spec.dst)?.value;
    if (typeof src === 'string' && typeof dst === 'string') return { src, dst };
  }
  return null;
}

export interface TimelineStep {
  index: number;
  /** Message name, e.g. "SYN", "query", "DISCOVER". */
  label: string;
  /** Microseconds after the scenario's base timestamp. */
  atUsec: number;
  stack: StackInstance;
  packet: SerializedPacket | null;
  serializeError: string | null;
  validation: ValidationIssue[];
  /** Source/destination identity (address string), or null when unreadable. */
  src: string | null;
  dst: string | null;
  /** Index into `Timeline.endpoints` for the sender, or -1 if unknown. */
  fromEndpoint: number;
  /** Index into `Timeline.endpoints` for the recipient, or -1 for broadcast/multicast/unknown. */
  toEndpoint: number;
}

export interface Timeline {
  /** The (up to two) endpoints the exchange runs between, as address strings. */
  endpoints: string[];
  steps: TimelineStep[];
}

/** Serialize a scenario's plans into a playable, direction-annotated timeline. */
export function deriveTimeline(plans: PacketPlan[], registry: Registry): Timeline {
  const partial = plans.map((plan, index) => {
    let packet: SerializedPacket | null = null;
    let serializeError: string | null = null;
    try {
      packet = serializeStack(plan.stack, registry);
    } catch (e) {
      serializeError = (e as Error).message;
    }
    const ends = packet ? packetEndpoints(packet) : null;
    return {
      index,
      label: plan.label,
      atUsec: plan.atUsec,
      stack: plan.stack,
      packet,
      serializeError,
      validation: validateStack(plan.stack, registry, packet ?? undefined),
      src: ends?.src ?? null,
      dst: ends?.dst ?? null,
    };
  });

  // Endpoints are the distinct senders, in first-seen order. If only one shows
  // up (e.g. a single packet), adopt a destination as the second endpoint so
  // the exchange still reads as a two-party conversation.
  const endpoints: string[] = [];
  for (const step of partial) {
    if (step.src && !endpoints.includes(step.src)) endpoints.push(step.src);
  }
  if (endpoints.length === 1) {
    const other = partial.find((s) => s.dst && s.dst !== endpoints[0])?.dst;
    if (other) endpoints.push(other);
  }

  const steps: TimelineStep[] = partial.map((step) => ({
    ...step,
    fromEndpoint: step.src ? endpoints.indexOf(step.src) : -1,
    toEndpoint: step.dst ? endpoints.indexOf(step.dst) : -1,
  }));

  return { endpoints, steps };
}

/** Playback position over a timeline. */
export interface Playback {
  step: number;
  playing: boolean;
}

export const initialPlayback: Playback = { step: 0, playing: false };

export type PlaybackAction =
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'toggle' }
  | { type: 'reset' }
  | { type: 'select'; index: number };

/**
 * Pure playback state machine. `count` is the number of steps; advancing past
 * the last step stops rather than wrapping, and playing from the end restarts.
 */
export function reducePlayback(
  state: Playback,
  action: PlaybackAction,
  count: number,
): Playback {
  const last = Math.max(0, count - 1);
  const clamp = (i: number) => Math.min(last, Math.max(0, i));
  switch (action.type) {
    case 'next':
      return state.step >= last
        ? { step: last, playing: false }
        : { ...state, step: state.step + 1 };
    case 'prev':
      return { ...state, step: clamp(state.step - 1) };
    case 'select':
      return { step: clamp(action.index), playing: false };
    case 'play':
      return { step: state.step >= last ? 0 : state.step, playing: count > 0 };
    case 'pause':
      return { ...state, playing: false };
    case 'toggle':
      return reducePlayback(state, { type: state.playing ? 'pause' : 'play' }, count);
    case 'reset':
      return { ...initialPlayback };
  }
}
