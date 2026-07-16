import type { Expr } from './model';

export interface ExprContext {
  /** Resolved numeric value of a same-layer, non-computed field. */
  getField(fieldId: string): number;
  payloadBytes: number;
  headerBytes: number;
}

export class ExprError extends Error {}

export function evalExpr(expr: Expr, ctx: ExprContext): number {
  switch (expr.kind) {
    case 'const':
      return expr.value;
    case 'field':
      return ctx.getField(expr.fieldId);
    case 'payloadBytes':
      return ctx.payloadBytes;
    case 'headerBytes':
      return ctx.headerBytes;
    case 'binop': {
      const l = evalExpr(expr.left, ctx);
      const r = evalExpr(expr.right, ctx);
      switch (expr.op) {
        case '+':
          return l + r;
        case '-':
          return l - r;
        case '*':
          return l * r;
        case 'div':
          if (r === 0) throw new ExprError('division by zero');
          return Math.floor(l / r);
      }
    }
  }
}

/** True if the expression references headerBytes anywhere (disallowed in length exprs). */
export function referencesHeaderBytes(expr: Expr): boolean {
  switch (expr.kind) {
    case 'headerBytes':
      return true;
    case 'binop':
      return referencesHeaderBytes(expr.left) || referencesHeaderBytes(expr.right);
    default:
      return false;
  }
}

// Convenience constructors for readable protocol definitions.
export const E = {
  const: (value: number): Expr => ({ kind: 'const', value }),
  field: (fieldId: string): Expr => ({ kind: 'field', fieldId }),
  payloadBytes: (): Expr => ({ kind: 'payloadBytes' }),
  headerBytes: (): Expr => ({ kind: 'headerBytes' }),
  add: (left: Expr, right: Expr): Expr => ({ kind: 'binop', op: '+', left, right }),
  sub: (left: Expr, right: Expr): Expr => ({ kind: 'binop', op: '-', left, right }),
  mul: (left: Expr, right: Expr): Expr => ({ kind: 'binop', op: '*', left, right }),
  div: (left: Expr, right: Expr): Expr => ({ kind: 'binop', op: 'div', left, right }),
};
