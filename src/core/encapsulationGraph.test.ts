import { describe, expect, it } from 'vitest';
import type { ProtocolDefinition } from './model';
import {
  bindingLabel,
  buildEncapsulationGraph,
  findCarrierPaths,
} from './encapsulationGraph';

const protocol = (
  id: string,
  layerHint: ProtocolDefinition['layerHint'],
  providesNamespaces: ProtocolDefinition['providesNamespaces'] = [],
  encapsulations: ProtocolDefinition['encapsulations'] = [],
): ProtocolDefinition => ({
  id,
  name: id.toUpperCase(),
  layerHint,
  source: id.startsWith('custom') ? 'custom' : 'builtin',
  fields: [],
  providesNamespaces,
  encapsulations,
});

const protocols = [
  protocol('ethernet', 'link', [
    { id: 'ethertype', displayName: 'EtherType', selectorFieldId: 'type' },
  ]),
  protocol(
    'ip',
    'network',
    [{ id: 'ip-proto', displayName: 'IP Protocol', selectorFieldId: 'protocol' }],
    [{ namespaceId: 'ethertype', value: 0x0800 }],
  ),
  protocol(
    'udp',
    'transport',
    [{ id: 'udp-port', displayName: 'UDP port', selectorFieldId: 'dst' }],
    [{ namespaceId: 'ip-proto', value: 17 }],
  ),
  protocol('custom-app', 'application', [], [{ namespaceId: 'udp-port', value: 4789 }]),
];

describe('encapsulation graph', () => {
  it('derives edges and assignments directly from protocol bindings', () => {
    const graph = buildEncapsulationGraph(protocols);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        outerId: 'udp',
        innerId: 'custom-app',
        namespaceId: 'udp-port',
        value: 4789,
      }),
    );
    expect(bindingLabel(graph.edges.find((edge) => edge.innerId === 'ip')!)).toBe(
      'EtherType 0x0800',
    );
  });

  it('finds a valid carrier path including custom protocols', () => {
    expect(findCarrierPaths(buildEncapsulationGraph(protocols), 'custom-app')[0]?.protocolIds).toEqual(
      ['ethernet', 'ip', 'udp', 'custom-app'],
    );
  });

  it('handles cycles and depth/result limits without repeating nodes', () => {
    const cyclic = [
      ...protocols,
      protocol(
        'tunnel',
        'tunnel',
        [{ id: 'ethertype', displayName: 'EtherType', selectorFieldId: 'type' }],
        [{ namespaceId: 'udp-port', value: 1 }],
      ),
    ];
    const graph = buildEncapsulationGraph(cyclic);
    const paths = findCarrierPaths(graph, 'custom-app', { maxDepth: 6, maxPaths: 1 });
    expect(paths).toHaveLength(1);
    expect(new Set(paths[0]!.protocolIds).size).toBe(paths[0]!.protocolIds.length);
    expect(findCarrierPaths(graph, 'custom-app', { maxDepth: 2 })).toEqual([]);
    expect(findCarrierPaths(graph, 'custom-app', { maxPaths: 0 })).toEqual([]);
  });
});
