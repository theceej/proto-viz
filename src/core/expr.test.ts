import { describe, expect, it } from 'vitest';
import { E, ExprError, evalExpr, referencesHeaderBytes, type ExprContext } from './expr';

const ctx = (fields: Record<string, number> = {}, payload = 10, header = 20): ExprContext => ({
  getField: (id) => {
    if (!(id in fields)) throw new ExprError(`unknown field "${id}"`);
    return fields[id]!;
  },
  payloadBytes: payload,
  headerBytes: header,
});

describe('evalExpr', () => {
  it('evaluates constants, fields, and byte counts', () => {
    expect(evalExpr(E.const(7), ctx())).toBe(7);
    expect(evalExpr(E.field('x'), ctx({ x: 42 }))).toBe(42);
    expect(evalExpr(E.payloadBytes(), ctx({}, 99))).toBe(99);
    expect(evalExpr(E.headerBytes(), ctx({}, 0, 24))).toBe(24);
  });

  it('evaluates arithmetic with integer division', () => {
    expect(evalExpr(E.add(E.const(2), E.const(3)), ctx())).toBe(5);
    expect(evalExpr(E.sub(E.const(2), E.const(3)), ctx())).toBe(-1);
    expect(evalExpr(E.mul(E.const(4), E.const(3)), ctx())).toBe(12);
    expect(evalExpr(E.div(E.const(7), E.const(2)), ctx())).toBe(3); // floor
    expect(evalExpr(E.div(E.headerBytes(), E.const(4)), ctx({}, 0, 20))).toBe(5); // IHL
  });

  it('evaluates nested expressions', () => {
    // (headerBytes - 6) + payloadBytes — the PPPoE length formula
    const expr = E.add(E.sub(E.headerBytes(), E.const(6)), E.payloadBytes());
    expect(evalExpr(expr, ctx({}, 100, 8))).toBe(102);
  });

  it('throws on division by zero', () => {
    expect(() => evalExpr(E.div(E.const(1), E.const(0)), ctx())).toThrow(ExprError);
  });

  it('propagates unknown-field errors from the context', () => {
    expect(() => evalExpr(E.field('nope'), ctx())).toThrow('unknown field');
  });
});

describe('referencesHeaderBytes', () => {
  it('detects headerBytes at any nesting depth', () => {
    expect(referencesHeaderBytes(E.headerBytes())).toBe(true);
    expect(referencesHeaderBytes(E.add(E.const(1), E.mul(E.headerBytes(), E.const(2))))).toBe(true);
    expect(referencesHeaderBytes(E.add(E.payloadBytes(), E.field('x')))).toBe(false);
    expect(referencesHeaderBytes(E.const(0))).toBe(false);
  });
});
