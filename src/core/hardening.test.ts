/** Tests for the DoS/abuse guards around untrusted protocol definitions. */
import { describe, expect, it } from 'vitest';
import { newLayer, type ProtocolDefinition } from './model';
import { SerializeError, serializeStack } from './serialize';
import { createRegistry } from './registry';
import { importLibraryJson, exportLibraryJson } from '../store/libraryJson';

const hostileProto = (bitLength: number | 'auto'): ProtocolDefinition => ({
  id: 'hostile',
  name: 'Hostile',
  layerHint: 'application',
  source: 'custom',
  fields: [{ id: 'big', name: 'Big', type: 'bytes', bitLength }],
  providesNamespaces: [],
  encapsulations: [],
});

describe('serializer allocation guards', () => {
  it('rejects a single field wider than the cap instead of allocating it', () => {
    const registry = createRegistry([hostileProto(1 << 30)]);
    const result = serializeStack({ layers: [newLayer('hostile')] }, registry);
    const err = result.issues.find((i) => i.severity === 'error')!;
    expect(err.message).toContain('limit');
    expect(result.bytes.length).toBe(0); // nothing was allocated for it
  });

  it('rejects a packet larger than the cap even from many legal fields', () => {
    // 512 fields x 64 KiB payload each via trailing payload is blocked at
    // total-size accounting: use a huge trailing payload directly.
    const registry = createRegistry([hostileProto(8)]);
    expect(() =>
      serializeStack(
        { layers: [newLayer('hostile')], trailingPayload: new Uint8Array((1 << 18) + 1) },
        registry,
      ),
    ).toThrow(SerializeError);
  });

  it('still serializes maximum-size real-world packets (64 KiB)', () => {
    const registry = createRegistry([hostileProto(8)]);
    const result = serializeStack(
      { layers: [newLayer('hostile')], trailingPayload: new Uint8Array(65535) },
      registry,
    );
    expect(result.bytes.length).toBe(65536);
  });
});

describe('library import validation guards', () => {
  const valid = hostileProto(8);

  it('rejects oversized field lengths', () => {
    const json = exportLibraryJson([hostileProto((1 << 20) + 8)]);
    expect(() => importLibraryJson(json)).toThrow('invalid field');
  });

  it('rejects non-integer and negative field lengths', () => {
    for (const bad of [-8, 3.5, Number.NaN]) {
      const json = exportLibraryJson([hostileProto(bad as number)]);
      expect(() => importLibraryJson(json)).toThrow('invalid field');
    }
  });

  it('rejects absurd protocol and field counts', () => {
    const many = JSON.stringify({
      app: 'proto-viz',
      version: 1,
      protocols: Array.from({ length: 501 }, (_, i) => ({ ...valid, id: `p${i}` })),
    });
    expect(() => importLibraryJson(many)).toThrow('limit is 500');

    const fat = {
      ...valid,
      fields: Array.from({ length: 1025 }, (_, i) => ({
        id: `f${i}`,
        name: 'F',
        type: 'uint',
        bitLength: 8,
      })),
    };
    expect(() => importLibraryJson(exportLibraryJson([fat as never]))).toThrow('invalid protocol');
  });

  it('rejects missing or oversized names', () => {
    expect(() =>
      importLibraryJson(exportLibraryJson([{ ...valid, name: 'x'.repeat(201) }])),
    ).toThrow('invalid protocol');
    expect(() => importLibraryJson(exportLibraryJson([{ ...valid, id: '' }]))).toThrow(
      'invalid protocol',
    );
  });

  it('accepts auto and expression lengths', () => {
    const withAuto = hostileProto('auto');
    const withExpr: ProtocolDefinition = {
      ...valid,
      fields: [
        {
          id: 'v',
          name: 'V',
          type: 'bytes',
          bitLength: { expr: { kind: 'payloadBytes' }, unit: 'bytes' },
        },
      ],
    };
    expect(importLibraryJson(exportLibraryJson([withAuto]))).toHaveLength(1);
    expect(importLibraryJson(exportLibraryJson([withExpr]))).toHaveLength(1);
  });
});
