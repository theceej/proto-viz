import { describe, expect, it } from 'vitest';
import { newLayer, type StackInstance } from './model';
import { validateStack } from './validate';
import { createBuiltinRegistry } from '../protocols';

const registry = createBuiltinRegistry();
const stack = (ids: string[]): StackInstance => ({ layers: ids.map(newLayer) });

describe('validateStack edge cases', () => {
  it('reports the empty stack as an informational nudge, not an error', () => {
    const issues = validateStack({ layers: [] }, registry);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('info');
    expect(issues[0]!.code).toBe('empty');
  });

  it('reports unknown protocol ids', () => {
    const issues = validateStack(stack(['ghost-proto']), registry);
    expect(issues.some((i) => i.code === 'unknown-protocol' && i.severity === 'error')).toBe(true);
  });

  it('marks HTTP-over-TLS as conventional, informational layering', () => {
    const issues = validateStack(stack(['ethernet', 'ipv4', 'tcp', 'tls', 'http1']), registry);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    const info = issues.find((i) => i.code === 'opaque-binding')!;
    expect(info.message).toContain('conventional');
  });

  it('warns about layers after an application-layer protocol', () => {
    // dns after http1 is both unbindable AND after an application layer
    const issues = validateStack(stack(['ethernet', 'ipv4', 'tcp', 'http1', 'dns']), registry);
    expect(issues.some((i) => i.code === 'layer-after-application')).toBe(true);
    expect(issues.some((i) => i.code === 'no-binding')).toBe(true);
  });

  it('suggests real carriers in no-binding errors', () => {
    const issues = validateStack(stack(['ethernet', 'dns']), registry);
    const err = issues.find((i) => i.code === 'no-binding')!;
    expect(err.suggestion).toContain('UDP');
    expect(err.suggestion).toContain('53');
  });

  it('accepts a lone link-layer frame', () => {
    expect(validateStack(stack(['ethernet']), registry)).toEqual([]);
  });

  it('flags OSPF directly under Ethernet (needs IP)', () => {
    const issues = validateStack(stack(['ethernet', 'ospf']), registry);
    const err = issues.find((i) => i.code === 'no-binding')!;
    expect(err.message).toContain('OSPF');
    expect(err.suggestion).toContain('IP Protocol 89');
  });
});
