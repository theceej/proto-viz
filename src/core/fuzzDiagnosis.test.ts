import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../protocols';
import { newLayer, type StackInstance } from './model';
import { serializeStack, type SerializedPacket } from './serialize';
import { fuzzPacket, type FuzzOptions, type FuzzResult } from './fuzz';
import { diagnoseFuzz } from './fuzzDiagnosis';

const registry = createBuiltinRegistry();

function build(): { stack: StackInstance; packet: SerializedPacket } {
  const stack: StackInstance = {
    layers: ['ethernet', 'ipv4', 'tcp'].map(newLayer),
    trailingPayload: Uint8Array.from([1, 2, 3, 4]),
  };
  return { stack, packet: serializeStack(stack, registry) };
}

const diagnose = (options: Partial<FuzzOptions>) => {
  const { stack, packet } = build();
  const result = fuzzPacket(stack, packet, registry, {
    seed: 1,
    strategy: 'bit-flip',
    count: 1,
    target: { layerUids: [] },
    ...options,
  });
  return { result, diagnosis: diagnoseFuzz({ stack, packet }, result, registry) };
};

/** A result whose bytes are supplied directly, for hand-built cases. */
const rawResult = (bytes: Uint8Array): FuzzResult => ({
  bytes,
  mutations: [],
  stack: null,
  lengthChanged: true,
  foldbackNote: 'hand-built',
});

describe('diagnoseFuzz', () => {
  it('reports a clean dissection when the corruption is only a value', () => {
    // Byte 22 is the IPv4 TTL: changing it breaks nothing structural.
    const { diagnosis } = diagnose({
      strategy: 'zero',
      target: { layerUids: [], byteRange: { start: 22, end: 22 } },
    });

    expect(diagnosis.decodedLayers).toEqual(['Ethernet II', 'IPv4', 'TCP']);
    expect(diagnosis.baselineLayers).toBe(3);
    expect(diagnosis.decodeExact).toBe(true);
    expect(diagnosis.steps[0]).toMatchObject({ stage: 'decode', severity: 'ok' });
  });

  it('reports where the dissector stopped when a length is overstated', () => {
    const { diagnosis } = diagnose({ strategy: 'length-overflow', count: 1, seed: 7 });

    expect(diagnosis.decodedLayers.length).toBeLessThan(diagnosis.baselineLayers);
    const step = diagnosis.steps.find((s) => s.stage === 'decode')!;
    expect(step.severity).toBe('error');
    expect(step.title).toMatch(/stopped after \d+ of 3 layers/);
    // The decoder's own note explains the failure, rather than a generic one.
    expect(step.detail).toMatch(/truncated|ends inside/i);
  });

  it('reports a truncated packet as undissectable and skips stack checks', () => {
    const { stack, packet } = build();
    const diagnosis = diagnoseFuzz(
      { stack, packet },
      rawResult(packet.bytes.slice(0, 4)),
      registry,
    );

    expect(diagnosis.decodedLayers).toEqual([]);
    expect(diagnosis.steps[0]).toMatchObject({ stage: 'decode', severity: 'error' });
    expect(diagnosis.steps[0]!.title).toMatch(/No layer could be read/);
    expect(diagnosis.introducedValidation).toEqual([]);
    expect(diagnosis.steps.some((s) => s.title.match(/does not apply/))).toBe(true);
  });

  it('only reports issues the mutation introduced', () => {
    // A stack that already warns: TTL 0 is flagged by the semantic linter.
    const stack: StackInstance = {
      layers: ['ethernet', 'ipv4', 'tcp'].map((id) =>
        id === 'ipv4' ? { ...newLayer(id), overrides: { ttl: 0 } } : newLayer(id),
      ),
    };
    const packet = serializeStack(stack, registry);
    // Mutate the header checksum, well away from the TTL that already warns.
    const result = fuzzPacket(stack, packet, registry, {
      seed: 3,
      strategy: 'boundary',
      count: 2,
      target: { layerUids: [], byteRange: { start: 24, end: 25 } },
    });
    const diagnosis = diagnoseFuzz({ stack, packet }, result, registry);

    // The pre-existing zero-TTL warning is not re-reported as "introduced".
    expect(diagnosis.introducedLint.map((issue) => issue.fieldId)).not.toContain('ttl');
  });

  it('always produces a decode step first, then validation and lint', () => {
    const { diagnosis } = diagnose({ strategy: 'boundary', count: 2, seed: 9 });
    expect(diagnosis.steps[0]!.stage).toBe('decode');
    expect(diagnosis.steps.map((s) => s.stage)).toEqual(['decode', 'validation', 'lint']);
  });

  it('reports the checksum a receiver would compute from a lying length', () => {
    // A mutation that overstates IPv4 Total Length leaves the transport
    // checksum bytes untouched — the packet still dissects and every structural
    // check passes, so without the receiver's view the diagnosis would say the
    // corruption was harmless. It is not: a receiver derives the TCP
    // pseudo-header length from that field and drops the segment.
    const { stack, packet } = build();
    const mutated: StackInstance = {
      ...stack,
      layers: stack.layers.map((layer) =>
        layer.protocolId === 'ipv4'
          ? { ...layer, overrides: { ...layer.overrides, totalLength: 60 }, pinned: ['totalLength'] }
          : layer,
      ),
    };
    const diagnosis = diagnoseFuzz(
      { stack, packet },
      {
        bytes: serializeStack(mutated, registry).bytes,
        mutations: [],
        stack: mutated,
        lengthChanged: false,
      },
      registry,
    );

    const issue = diagnosis.introducedValidation.find((i) => i.code === 'pseudo-header-mismatch');
    expect(issue).toBeDefined();
    expect(issue!.message).toContain('Total Length');
  });

  it('handles a packet with no layers at all', () => {
    const stack: StackInstance = { layers: [] };
    const packet = serializeStack(stack, registry);
    const diagnosis = diagnoseFuzz({ stack, packet }, rawResult(new Uint8Array([1, 2])), registry);

    expect(diagnosis.decodedLayers).toEqual([]);
    expect(diagnosis.baselineLayers).toBe(0);
  });
});
