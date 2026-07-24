import { describe, expect, it } from 'vitest';
import { exportLibraryJson, importLibraryJson } from './libraryJson';
import type { ProtocolDefinition } from '../core/model';

const custom: ProtocolDefinition = {
  id: 'my-proto',
  name: 'MyProto',
  layerHint: 'application',
  source: 'custom',
  fields: [
    { id: 'magic', name: 'Magic', type: 'bytes', bitLength: 32, default: Uint8Array.from([0xde, 0xad, 0xbe, 0xef]) },
    { id: 'len', name: 'Length', type: 'uint', bitLength: 16, computed: { kind: 'expr', expr: { kind: 'payloadBytes' } } },
    { id: 'body', name: 'Body', type: 'bytes', bitLength: 'auto' },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: 'udp-dstport', value: 4000 }],
  lintRules: [
    {
      kind: 'value',
      fieldId: 'len',
      operator: 'equals',
      value: 0,
      severity: 'advisory',
      code: 'empty-body',
      message: 'A zero-length body is unusual.',
    },
  ],
};

describe('library JSON export/import', () => {
  it('round-trips definitions including Uint8Array defaults and expr ASTs', () => {
    const json = exportLibraryJson([custom]);
    const [restored] = importLibraryJson(json);
    expect(restored!.id).toBe('my-proto');
    const magic = restored!.fields.find((f) => f.id === 'magic')!;
    expect(magic.default).toBeInstanceOf(Uint8Array);
    expect([...(magic.default as Uint8Array)]).toEqual([0xde, 0xad, 0xbe, 0xef]);
    const len = restored!.fields.find((f) => f.id === 'len')!;
    expect(len.computed).toEqual({ kind: 'expr', expr: { kind: 'payloadBytes' } });
    expect(restored!.encapsulations).toEqual([{ namespaceId: 'udp-dstport', value: 4000 }]);
    expect(restored!.lintRules).toEqual(custom.lintRules);
  });

  it('forces source to custom on import', () => {
    const json = exportLibraryJson([{ ...custom, source: 'builtin' }]);
    expect(importLibraryJson(json)[0]!.source).toBe('custom');
  });

  it('rejects non-library JSON', () => {
    expect(() => importLibraryJson('{"foo": 1}')).toThrow('Not a proto-viz library');
    expect(() => importLibraryJson('[]')).toThrow();
    expect(() => importLibraryJson('not json')).toThrow();
  });

  it('rejects malformed protocol entries', () => {
    const bad = JSON.stringify({ app: 'proto-viz', version: 1, protocols: [{ id: 42 }] });
    expect(() => importLibraryJson(bad)).toThrow('invalid protocol');
  });

  it('rejects unsafe or malformed semantic lint rules', () => {
    const unknownField = exportLibraryJson([
      {
        ...custom,
        lintRules: [{ ...custom.lintRules![0]!, fieldId: 'missing' }],
      },
    ]);
    expect(() => importLibraryJson(unknownField)).toThrow('invalid semantic lint rule');

    const unknownKind = JSON.parse(exportLibraryJson([custom]));
    unknownKind.protocols[0].lintRules[0].kind = 'execute-code';
    expect(() => importLibraryJson(JSON.stringify(unknownKind))).toThrow(
      'invalid semantic lint rule',
    );
  });
});
