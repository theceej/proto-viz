import { describe, expect, it } from 'vitest';
import { carriersOf, resolveBinding } from './bindings';
import type { ProtocolDefinition } from './model';

const proto = (
  id: string,
  provides: ProtocolDefinition['providesNamespaces'],
  claims: ProtocolDefinition['encapsulations'],
): ProtocolDefinition => ({
  id,
  name: id,
  layerHint: 'network',
  fields: [],
  providesNamespaces: provides,
  encapsulations: claims,
  source: 'builtin',
});

describe('resolveBinding', () => {
  it('prefers a value-carrying claim over an opaque one', () => {
    const outer = proto(
      'outer',
      [
        { id: 'opaque-ns', displayName: 'opaque', selectorFieldId: null },
        { id: 'typed-ns', displayName: 'typed', selectorFieldId: 'sel' },
      ],
      [],
    );
    const inner = proto('inner', [], [
      { namespaceId: 'opaque-ns' },
      { namespaceId: 'typed-ns', value: 5 },
    ]);
    const binding = resolveBinding(outer, inner)!;
    expect(binding.namespace.id).toBe('typed-ns');
    expect(binding.claim.value).toBe(5);
  });

  it('falls back to an opaque claim when no typed claim matches', () => {
    const outer = proto('outer', [{ id: 'opaque-ns', displayName: 'o', selectorFieldId: null }], []);
    const inner = proto('inner', [], [
      { namespaceId: 'other-ns', value: 1 },
      { namespaceId: 'opaque-ns' },
    ]);
    expect(resolveBinding(outer, inner)!.namespace.id).toBe('opaque-ns');
  });

  it('returns null when nothing intersects', () => {
    const outer = proto('outer', [{ id: 'a', displayName: 'a', selectorFieldId: 'x' }], []);
    const inner = proto('inner', [], [{ namespaceId: 'b', value: 1 }]);
    expect(resolveBinding(outer, inner)).toBeNull();
  });

  it('ignores a value claim on a namespace whose provider is opaque', () => {
    // Claim has a value, but the provider has no selector field — still a
    // legal (opaque) binding, not a typed one.
    const outer = proto('outer', [{ id: 'ns', displayName: 'ns', selectorFieldId: null }], []);
    const inner = proto('inner', [], [{ namespaceId: 'ns', value: 9 }]);
    const binding = resolveBinding(outer, inner)!;
    expect(binding.namespace.selectorFieldId).toBeNull();
  });
});

describe('carriersOf', () => {
  it('lists every protocol providing a claimed namespace', () => {
    const eth = proto('eth', [{ id: 'ethertype', displayName: 'EtherType', selectorFieldId: 'et' }], []);
    const vlan = proto('vlan', [{ id: 'ethertype', displayName: 'EtherType', selectorFieldId: 'et' }], []);
    const other = proto('other', [{ id: 'ports', displayName: 'p', selectorFieldId: 'd' }], []);
    const ip = proto('ip', [], [{ namespaceId: 'ethertype', value: 0x0800 }]);
    expect(carriersOf(ip, [eth, vlan, other, ip]).map((p) => p.id)).toEqual(['eth', 'vlan']);
  });
});
