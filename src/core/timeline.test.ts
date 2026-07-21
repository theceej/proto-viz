import { describe, expect, it } from 'vitest';
import { newLayer, type StackInstance } from './model';
import { scenarios } from './scenarios';
import { createBuiltinRegistry } from '../protocols';
import {
  deriveTimeline,
  initialPlayback,
  reducePlayback,
  type Playback,
} from './timeline';

const registry = createBuiltinRegistry();

const stack = (ids: string[], payload?: string): StackInstance => ({
  layers: ids.map(newLayer),
  trailingPayload: payload ? new TextEncoder().encode(payload) : undefined,
});

const byId = (id: string) => scenarios.find((s) => s.id === id)!;

const timelineFor = (scenarioId: string, base: StackInstance) =>
  deriveTimeline(byId(scenarioId).generate(base, registry), registry);

describe('deriveTimeline', () => {
  it('serializes every step and records its message label and time', () => {
    const t = timelineFor('tcp-handshake', stack(['ethernet', 'ipv4', 'tcp']));
    expect(t.steps.map((s) => s.label)).toEqual(['SYN', 'SYN-ACK', 'ACK']);
    expect(t.steps.every((s) => s.packet !== null && s.serializeError === null)).toBe(true);
    expect(t.steps.map((s) => s.atUsec)).toEqual([0, 20_000, 40_000]);
  });

  it('finds the two endpoints and alternates direction across a handshake', () => {
    const t = timelineFor('tcp-handshake', stack(['ethernet', 'ipv4', 'tcp']));
    expect(t.endpoints).toHaveLength(2);
    // SYN and ACK come from endpoint A; SYN-ACK comes from endpoint B.
    expect(t.steps.map((s) => s.fromEndpoint)).toEqual([0, 1, 0]);
    expect(t.steps.map((s) => s.toEndpoint)).toEqual([1, 0, 1]);
  });

  it('reads endpoints from the IPv4 addresses, not the MACs', () => {
    const t = timelineFor('icmp-ping', stack(['ethernet', 'ipv4', 'icmp']));
    expect(t.endpoints).toEqual(['192.0.2.1', '198.51.100.1']);
    expect(t.steps.map((s) => s.label)).toEqual(['echo request', 'echo reply']);
    expect(t.steps.map((s) => s.fromEndpoint)).toEqual([0, 1]);
  });

  it('handles a DNS query/response pair', () => {
    const t = timelineFor('dns-query-response', stack(['ethernet', 'ipv4', 'udp', 'dns']));
    expect(t.steps.map((s) => s.fromEndpoint)).toEqual([0, 1]);
    expect(t.endpoints).toHaveLength(2);
  });

  it('handles the DHCP DORA exchange', () => {
    const t = timelineFor('dhcp-dora', stack(['ethernet', 'ipv4', 'udp', 'dhcp']));
    expect(t.steps.map((s) => s.label)).toEqual(['DISCOVER', 'OFFER', 'REQUEST', 'ACK']);
    expect(t.steps).toHaveLength(4);
  });

  it('marks a multicast destination as belonging to no endpoint', () => {
    // The Neighbor Solicitation targets a solicited-node multicast address,
    // which is neither of the two conversing endpoints.
    const t = timelineFor('ndp-exchange', stack(['ethernet', 'ipv6']));
    const solicitation = t.steps.find((s) => s.label === 'Neighbor Solicitation')!;
    expect(solicitation.fromEndpoint).toBe(0);
    expect(solicitation.toEndpoint).toBe(-1);
  });

  it('adopts a destination as the second endpoint for a single packet', () => {
    const t = timelineFor('single', stack(['ethernet', 'ipv4', 'tcp']));
    expect(t.steps).toHaveLength(1);
    expect(t.endpoints).toHaveLength(2);
    expect(t.steps[0]!.fromEndpoint).toBe(0);
    expect(t.steps[0]!.toEndpoint).toBe(1);
  });

  it('surfaces a serialization failure without throwing', () => {
    const plans = [{ label: 'broken', atUsec: 0, stack: { layers: [newLayer('nonexistent')] } }];
    const t = deriveTimeline(plans, registry);
    expect(t.steps[0]!.packet).toBeNull();
    expect(t.steps[0]!.serializeError).toBeTruthy();
    expect(t.endpoints).toEqual([]);
  });
});

describe('reducePlayback', () => {
  const run = (state: Playback, ...actions: Parameters<typeof reducePlayback>[1][]) =>
    actions.reduce((s, a) => reducePlayback(s, a, 3), state);

  it('advances and clamps at the last step, stopping playback', () => {
    expect(reducePlayback({ step: 0, playing: true }, { type: 'next' }, 3)).toEqual({
      step: 1,
      playing: true,
    });
    expect(reducePlayback({ step: 2, playing: true }, { type: 'next' }, 3)).toEqual({
      step: 2,
      playing: false,
    });
  });

  it('steps back and clamps at zero', () => {
    expect(run({ step: 2, playing: false }, { type: 'prev' }, { type: 'prev' })).toEqual({
      step: 0,
      playing: false,
    });
    expect(reducePlayback({ step: 0, playing: false }, { type: 'prev' }, 3).step).toBe(0);
  });

  it('selects a step (clamped) and pauses', () => {
    expect(reducePlayback(initialPlayback, { type: 'select', index: 5 }, 3)).toEqual({
      step: 2,
      playing: false,
    });
    expect(reducePlayback({ step: 1, playing: true }, { type: 'select', index: -3 }, 3)).toEqual({
      step: 0,
      playing: false,
    });
  });

  it('plays, and restarts from the beginning when already at the end', () => {
    expect(reducePlayback({ step: 1, playing: false }, { type: 'play' }, 3)).toEqual({
      step: 1,
      playing: true,
    });
    expect(reducePlayback({ step: 2, playing: false }, { type: 'play' }, 3)).toEqual({
      step: 0,
      playing: true,
    });
  });

  it('pauses and toggles', () => {
    expect(reducePlayback({ step: 1, playing: true }, { type: 'pause' }, 3).playing).toBe(false);
    expect(reducePlayback({ step: 1, playing: false }, { type: 'toggle' }, 3).playing).toBe(true);
    expect(reducePlayback({ step: 1, playing: true }, { type: 'toggle' }, 3).playing).toBe(false);
  });

  it('resets to the start', () => {
    expect(reducePlayback({ step: 2, playing: true }, { type: 'reset' }, 3)).toEqual(initialPlayback);
  });

  it('never plays an empty timeline', () => {
    expect(reducePlayback(initialPlayback, { type: 'play' }, 0)).toEqual({
      step: 0,
      playing: false,
    });
  });
});
