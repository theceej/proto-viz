import { describe, expect, it } from 'vitest';
import { newLayer, type StackInstance } from './model';
import { getValidNextProtocols, validateStack } from './validate';
import { createBuiltinRegistry } from '../protocols';

const registry = createBuiltinRegistry();

const stack = (ids: string[]): StackInstance => ({ layers: ids.map(newLayer) });
const errors = (s: StackInstance) =>
  validateStack(s, registry).filter((i) => i.severity === 'error');

describe('validateStack', () => {
  it('accepts classic stacks', () => {
    expect(errors(stack(['ethernet', 'ipv4', 'tcp']))).toEqual([]);
    expect(errors(stack(['ethernet', 'ipv4', 'udp']))).toEqual([]);
    expect(errors(stack(['ethernet', 'ipv4', 'icmp']))).toEqual([]);
    expect(errors(stack(['ethernet', 'vlan-8021q', 'ipv4', 'udp']))).toEqual([]);
  });

  it('accepts Q-in-Q double tagging', () => {
    expect(errors(stack(['ethernet', 'vlan-8021q', 'vlan-8021q', 'ipv4']))).toEqual([]);
  });

  it('rejects TCP directly on Ethernet with an explanation', () => {
    const issues = validateStack(stack(['ethernet', 'tcp']), registry);
    const err = issues.find((i) => i.code === 'no-binding')!;
    expect(err.severity).toBe('error');
    expect(err.message).toContain('TCP cannot follow Ethernet II');
    expect(err.message).toContain('EtherType');
    expect(err.suggestion).toContain('IPv4');
  });

  it('rejects IPv4 under UDP', () => {
    expect(errors(stack(['ethernet', 'ipv4', 'udp', 'ipv4']))).toHaveLength(1);
  });

  it('allows IP-in-IP', () => {
    expect(errors(stack(['ethernet', 'ipv4', 'ipv4', 'udp']))).toEqual([]);
  });

  it('flags an ICMP quoted datagram as info, not error', () => {
    const issues = validateStack(stack(['ethernet', 'ipv4', 'icmp', 'ipv4']), registry);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(issues.some((i) => i.code === 'opaque-binding')).toBe(true);
  });

  it('warns when a stack starts at the network layer', () => {
    const issues = validateStack(stack(['ipv4', 'udp']), registry);
    expect(issues.some((i) => i.code === 'no-link-layer' && i.severity === 'warning')).toBe(true);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('rejects a transport-layer start outright', () => {
    const issues = validateStack(stack(['tcp']), registry);
    expect(issues.some((i) => i.code === 'bad-first-layer' && i.severity === 'error')).toBe(true);
  });

  it('warns when a pinned selector contradicts the next layer', () => {
    const s = stack(['ethernet', 'ipv4']);
    s.layers[0]!.overrides['etherType'] = 0x86dd;
    s.layers[0]!.pinned = ['etherType'];
    const issues = validateStack(s, registry);
    expect(issues.some((i) => i.code === 'pinned-selector-mismatch')).toBe(true);
  });
});

describe('getValidNextProtocols', () => {
  it('allows everything on an empty stack, with notes for non-link starts', () => {
    const opts = getValidNextProtocols({ layers: [] }, registry);
    expect(opts.every((o) => o.allowed)).toBe(true);
    expect(opts.find((o) => o.protocolId === 'ipv4')!.note).toContain('RAW');
    expect(opts.find((o) => o.protocolId === 'ethernet')!.note).toBeUndefined();
  });

  it('describes the binding for legal next layers', () => {
    const opts = getValidNextProtocols(stack(['ethernet']), registry);
    const ipv4 = opts.find((o) => o.protocolId === 'ipv4')!;
    expect(ipv4.allowed).toBe(true);
    expect(ipv4.via).toBe('EtherType 0x0800');
    const tcp = opts.find((o) => o.protocolId === 'tcp')!;
    expect(tcp.allowed).toBe(false);
    expect(tcp.reason).toContain('EtherType');
  });

  it('offers transports under IPv4', () => {
    const opts = getValidNextProtocols(stack(['ethernet', 'ipv4']), registry);
    expect(opts.find((o) => o.protocolId === 'tcp')!.via).toBe('IP Protocol 6');
    expect(opts.find((o) => o.protocolId === 'udp')!.via).toBe('IP Protocol 17');
    expect(opts.find((o) => o.protocolId === 'ethernet')!.allowed).toBe(false);
  });
});

describe('IPv6 extension-header ordering', () => {
  const warningCodes = (s: StackInstance) =>
    validateStack(s, registry)
      .filter((i) => i.severity === 'warning')
      .map((i) => i.code);

  it('accepts legal extension-header chains without ordering warnings', () => {
    for (const s of [
      stack(['ethernet', 'ipv6', 'ipv6-hopopts', 'udp']),
      stack(['ethernet', 'ipv6', 'ipv6-hopopts', 'ipv6-routing', 'ipv6-frag', 'tcp']),
      stack(['ethernet', 'ipv6', 'ipv6-dstopts', 'ipv6-routing', 'ipv6-dstopts', 'tcp']),
    ]) {
      expect(errors(s)).toEqual([]);
      const codes = warningCodes(s);
      expect(codes).not.toContain('hopopts-not-first');
      expect(codes).not.toContain('duplicate-ext-header');
      expect(codes).not.toContain('ext-header-order');
    }
  });

  it('warns when Hop-by-Hop Options is not immediately after IPv6', () => {
    const issue = validateStack(
      stack(['ethernet', 'ipv6', 'ipv6-routing', 'ipv6-hopopts', 'tcp']),
      registry,
    ).find((i) => i.code === 'hopopts-not-first')!;
    expect(issue.severity).toBe('warning');
    expect(issue.message).toContain('immediately follow the IPv6 header');
  });

  it('warns on a duplicated extension header', () => {
    expect(warningCodes(stack(['ethernet', 'ipv6', 'ipv6-frag', 'ipv6-frag', 'tcp']))).toContain(
      'duplicate-ext-header',
    );
  });

  it('allows Destination Options twice but not three times', () => {
    expect(
      warningCodes(stack(['ethernet', 'ipv6', 'ipv6-dstopts', 'ipv6-routing', 'ipv6-dstopts', 'tcp'])),
    ).not.toContain('duplicate-ext-header');
    expect(
      warningCodes(stack(['ethernet', 'ipv6', 'ipv6-dstopts', 'ipv6-dstopts', 'ipv6-dstopts', 'tcp'])),
    ).toContain('duplicate-ext-header');
  });

  it('warns when Fragment precedes Routing', () => {
    const issue = validateStack(
      stack(['ethernet', 'ipv6', 'ipv6-frag', 'ipv6-routing', 'tcp']),
      registry,
    ).find((i) => i.code === 'ext-header-order')!;
    expect(issue.severity).toBe('warning');
    expect(issue.message).toContain('Routing');
  });
});
