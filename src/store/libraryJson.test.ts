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

function libraryWithLintRules(lintRules: unknown): string {
  const library = JSON.parse(exportLibraryJson([custom]));
  library.protocols[0].lintRules = lintRules;
  return JSON.stringify(library);
}

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

  it('imports every supported semantic lint rule shape', () => {
    const common = {
      fieldId: 'len',
      severity: 'warning' as const,
      code: 'test-rule',
      message: 'Test message.',
      reference: 'RFC test',
    };
    const lintRules: NonNullable<ProtocolDefinition['lintRules']> = [
      { ...common, kind: 'value', operator: 'notEquals', value: 1 },
      { ...common, kind: 'bitsClear', mask: 1 },
      { ...common, kind: 'incompatibleBits', leftMask: 1, rightMask: 2 },
      { ...common, kind: 'sourceAddress', family: 'ipv4' },
      { ...common, kind: 'sourceAddress', family: 'ipv6' },
      { ...common, kind: 'zeroWhenCarriedBy', protocolId: 'ipv6' },
      { ...common, kind: 'payloadBindingMismatch' },
      { ...common, kind: 'wellKnownPayload' },
    ];

    expect(importLibraryJson(libraryWithLintRules(lintRules))[0]!.lintRules).toEqual(
      lintRules,
    );
  });

  it.each([
    ['a non-array rules value', {}],
    ['too many rules', Array.from({ length: 129 }, () => custom.lintRules![0])],
  ])('rejects %s', (_description, lintRules) => {
    expect(() => importLibraryJson(libraryWithLintRules(lintRules))).toThrow(
      'invalid semantic lint rules',
    );
  });

  it.each([
    ['a null rule', null],
    ['an unknown field', { ...custom.lintRules![0], fieldId: 'missing' }],
    ['an invalid severity', { ...custom.lintRules![0], severity: 'error' }],
    ['an empty code', { ...custom.lintRules![0], code: '' }],
    ['an overlong code', { ...custom.lintRules![0], code: 'x'.repeat(201) }],
    ['an empty message', { ...custom.lintRules![0], message: '' }],
    ['an overlong message', { ...custom.lintRules![0], message: 'x'.repeat(1001) }],
    ['a non-string reference', { ...custom.lintRules![0], reference: 42 }],
    ['an overlong reference', { ...custom.lintRules![0], reference: 'x'.repeat(501) }],
    ['an invalid value operator', { ...custom.lintRules![0], operator: 'contains' }],
    ['a non-finite value', { ...custom.lintRules![0], value: null }],
    [
      'a non-integer bits-clear mask',
      { ...custom.lintRules![0], kind: 'bitsClear', mask: 1.5 },
    ],
    ['a negative bits-clear mask', { ...custom.lintRules![0], kind: 'bitsClear', mask: -1 }],
    [
      'a non-integer incompatible left mask',
      { ...custom.lintRules![0], kind: 'incompatibleBits', leftMask: 1.5, rightMask: 2 },
    ],
    [
      'a zero incompatible left mask',
      { ...custom.lintRules![0], kind: 'incompatibleBits', leftMask: 0, rightMask: 2 },
    ],
    [
      'a non-integer incompatible right mask',
      { ...custom.lintRules![0], kind: 'incompatibleBits', leftMask: 1, rightMask: 1.5 },
    ],
    [
      'a zero incompatible right mask',
      { ...custom.lintRules![0], kind: 'incompatibleBits', leftMask: 1, rightMask: 0 },
    ],
    [
      'an invalid source address family',
      { ...custom.lintRules![0], kind: 'sourceAddress', family: 'ipx' },
    ],
    [
      'a non-string carrier protocol',
      { ...custom.lintRules![0], kind: 'zeroWhenCarriedBy', protocolId: 42 },
    ],
    [
      'an overlong carrier protocol',
      {
        ...custom.lintRules![0],
        kind: 'zeroWhenCarriedBy',
        protocolId: 'x'.repeat(201),
      },
    ],
  ])('rejects a semantic lint rule with %s', (_description, rule) => {
    expect(() => importLibraryJson(libraryWithLintRules([rule]))).toThrow(
      'invalid semantic lint rule',
    );
  });
});
