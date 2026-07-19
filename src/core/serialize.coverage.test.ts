import { describe, expect, it } from 'vitest';
import { newLayer, type ProtocolDefinition, type StackInstance } from './model';
import { serializeStack } from './serialize';
import { createRegistry } from './registry';
import { createBuiltinRegistry } from '../protocols';
import { enumTables } from '../protocols/enums';
import { E } from './expr';

/**
 * Targeted checks for serialize.ts error and edge paths that the round-trip
 * and scenario suites don't reach: layout failures, checksum failures, and the
 * no-enclosing-IP / no-own-protocol pseudo-header branches. Small custom
 * protocol definitions exercise the failure modes deterministically.
 */

const builtin = createBuiltinRegistry();

/** A one-off protocol definition with sensible defaults for the boilerplate. */
const proto = (id: string, fields: ProtocolDefinition['fields']): ProtocolDefinition => ({
  id,
  name: id,
  layerHint: 'application',
  source: 'custom',
  fields,
  providesNamespaces: [],
  encapsulations: [],
});

/** Serialize a single custom layer and return the resulting packet. */
const runSingle = (def: ProtocolDefinition, overrides: Record<string, never> = {}) => {
  const registry = createRegistry([def], enumTables);
  const stack: StackInstance = { layers: [{ ...newLayer(def.id), overrides }] };
  return serializeStack(stack, registry);
};

const errorMessages = (result: { issues: { severity: string; message: string }[] }) =>
  result.issues.filter((i) => i.severity === 'error').map((i) => i.message);

describe('serializeStack failure paths', () => {
  it('reports a non-numeric override on a plain uint field as an error', () => {
    const stack: StackInstance = { layers: [newLayer('ethernet'), newLayer('ipv4')] };
    stack.layers[1]!.overrides['ttl'] = 'not-a-number' as unknown as number;
    const result = serializeStack(stack, builtin);
    expect(errorMessages(result).some((m) => m.includes('TTL'))).toBe(true);
  });

  it('reports a pinned checksum with an invalid value as an error', () => {
    const stack: StackInstance = { layers: [newLayer('ethernet'), newLayer('ipv4')] };
    stack.layers[1]!.overrides['headerChecksum'] = 'xyz' as unknown as number;
    stack.layers[1]!.pinned = ['headerChecksum'];
    const result = serializeStack(stack, builtin);
    expect(errorMessages(result).some((m) => m.includes('Header Checksum'))).toBe(true);
  });

  it('warns when a pseudo-header checksum has no enclosing IP layer', () => {
    // UDP on its own has nowhere to read src/dst from.
    const result = serializeStack({ layers: [newLayer('udp')] }, builtin);
    const warn = result.issues.find((i) => i.severity === 'warning');
    expect(warn?.message).toContain('no enclosing IP layer');
  });

  it('errors on an auto-length field that is not byte-typed', () => {
    const result = runSingle(proto('cov-autouint', [{ id: 'f', name: 'F', type: 'uint', bitLength: 'auto' }]));
    expect(errorMessages(result).some((m) => m.includes('auto length'))).toBe(true);
  });

  it('errors when a layout length expression references headerBytes', () => {
    const result = runSingle(
      proto('cov-hdrbytes', [
        {
          id: 'f',
          name: 'F',
          type: 'bytes',
          bitLength: { expr: E.headerBytes(), unit: 'bytes' },
          default: new Uint8Array(0),
        },
      ]),
    );
    expect(errorMessages(result).some((m) => m.includes('headerBytes'))).toBe(true);
  });

  it('errors on a negative computed field length', () => {
    const result = runSingle(
      proto('cov-neg', [
        { id: 'f', name: 'F', type: 'uint', bitLength: { expr: E.sub(E.const(0), E.const(8)), unit: 'bits' } },
      ]),
    );
    expect(errorMessages(result).some((m) => m.includes('negative length'))).toBe(true);
  });

  it('errors when a byte field length is not byte-aligned', () => {
    const result = runSingle(
      proto('cov-fit', [
        {
          id: 'f',
          name: 'F',
          type: 'bytes',
          bitLength: { expr: E.const(12), unit: 'bits' },
          default: new Uint8Array(0),
        },
      ]),
    );
    expect(errorMessages(result).some((m) => m.includes('byte-aligned'))).toBe(true);
  });

  it('errors and pads when a header is not a whole number of bytes', () => {
    const result = runSingle(proto('cov-nibble', [{ id: 'f', name: 'F', type: 'uint', bitLength: 4, default: 0 }]));
    expect(errorMessages(result).some((m) => m.includes('not a whole number of bytes'))).toBe(true);
    // Padded up so downstream stays byte-aligned.
    expect(result.layers[0]!.headerBytes).toBe(1);
  });

  it('errors when a presentIf references an unknown field', () => {
    const result = runSingle(
      proto('cov-unknown', [
        { id: 'x', name: 'X', type: 'uint', bitLength: 8, default: 0, presentIf: E.field('nope') },
      ]),
    );
    expect(errorMessages(result).some((m) => m.includes('unknown field'))).toBe(true);
  });

  it('errors when a layout expression references a computed field', () => {
    const result = runSingle(
      proto('cov-computedref', [
        { id: 'len', name: 'L', type: 'uint', bitLength: 8, computed: { kind: 'expr', expr: E.const(1) } },
        { id: 'x', name: 'X', type: 'uint', bitLength: 8, default: 0, presentIf: E.field('len') },
      ]),
    );
    expect(errorMessages(result).some((m) => m.includes('computed field'))).toBe(true);
  });

  it('errors when a computed expression references another computed field', () => {
    const result = runSingle(
      proto('cov-exprref', [
        { id: 'b', name: 'B', type: 'uint', bitLength: 8, computed: { kind: 'expr', expr: E.const(1) } },
        { id: 'a', name: 'A', type: 'uint', bitLength: 8, computed: { kind: 'expr', expr: E.field('b') } },
      ]),
    );
    expect(errorMessages(result).some((m) => m.includes('computed field'))).toBe(true);
  });

  it('resolves a computed expression that references a plain field', () => {
    const result = runSingle(
      proto('cov-plainref', [
        { id: 'b', name: 'B', type: 'uint', bitLength: 8, default: 7 },
        { id: 'a', name: 'A', type: 'uint', bitLength: 8, computed: { kind: 'expr', expr: E.add(E.field('b'), E.const(1)) } },
      ]),
    );
    expect(errorMessages(result)).toEqual([]);
    // Second byte is the computed field: b (7) + 1 = 8.
    expect(result.bytes[1]).toBe(8);
  });

  it('reads the protocol byte from IPv4 when the checksummed layer claims no ip-proto', () => {
    // A custom transport with an IPv4 pseudo-header checksum but no ip-proto
    // claim of its own: the pseudo-header must fall back to IPv4's Protocol.
    const covProto = proto('cov-transport', [
      { id: 'data', name: 'Data', type: 'uint', bitLength: 16, default: 0x1234 },
      {
        id: 'ck',
        name: 'Checksum',
        type: 'uint',
        bitLength: 16,
        computed: { kind: 'checksum', algorithm: 'inet16', scope: 'header', pseudoHeader: 'ipv4' },
      },
    ]);
    const registry = createBuiltinRegistry([covProto]);
    const result = serializeStack({ layers: [newLayer('ipv4'), newLayer('cov-transport')] }, registry);
    expect(errorMessages(result)).toEqual([]);
    const ck = result.spans.find((s) => s.fieldId === 'ck')!;
    expect(ck.value).not.toBe(0);
  });
});
