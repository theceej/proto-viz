import type { ProtocolDefinition } from './model';
import { resolveBinding } from './bindings';

export interface EncapsulationEdge {
  outerId: string;
  innerId: string;
  namespaceId: string;
  namespaceName: string;
  selectorFieldId: string | null;
  value?: number;
  conventional: boolean;
}

export interface EncapsulationGraph {
  protocols: readonly ProtocolDefinition[];
  edges: EncapsulationEdge[];
}

export interface CarrierPath {
  protocolIds: string[];
  edges: EncapsulationEdge[];
}

/** Derive every valid direct carrier relationship from the registry model. */
export function buildEncapsulationGraph(
  protocols: readonly ProtocolDefinition[],
): EncapsulationGraph {
  const edges: EncapsulationEdge[] = [];
  for (const outer of protocols) {
    for (const inner of protocols) {
      const binding = resolveBinding(outer, inner);
      if (!binding) continue;
      edges.push({
        outerId: outer.id,
        innerId: inner.id,
        namespaceId: binding.namespace.id,
        namespaceName: binding.namespace.displayName,
        selectorFieldId: binding.namespace.selectorFieldId,
        value: binding.claim.value,
        conventional: Boolean(binding.claim.conventional),
      });
    }
  }
  return { protocols, edges };
}

/**
 * Find shortest valid paths from link-layer protocols to `targetId`.
 * A protocol may appear only once in a path, preventing tunnel cycles; depth
 * and result caps keep imported/custom graphs bounded.
 */
export function findCarrierPaths(
  graph: EncapsulationGraph,
  targetId: string,
  options: { maxDepth?: number; maxPaths?: number } = {},
): CarrierPath[] {
  const maxDepth = options.maxDepth ?? 8;
  const maxPaths = options.maxPaths ?? 8;
  if (maxDepth < 1 || maxPaths < 1) return [];

  const outgoing = new Map<string, EncapsulationEdge[]>();
  for (const edge of graph.edges) {
    const list = outgoing.get(edge.outerId) ?? [];
    list.push(edge);
    outgoing.set(edge.outerId, list);
  }
  const starts = graph.protocols
    .filter((protocol) => protocol.layerHint === 'link')
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  const queue: CarrierPath[] = starts.map((protocol) => ({
    protocolIds: [protocol.id],
    edges: [],
  }));
  const results: CarrierPath[] = [];

  while (queue.length > 0 && results.length < maxPaths) {
    const path = queue.shift()!;
    const current = path.protocolIds.at(-1)!;
    if (current === targetId) {
      results.push(path);
      continue;
    }
    if (path.protocolIds.length >= maxDepth) continue;
    for (const edge of outgoing.get(current) ?? []) {
      if (path.protocolIds.includes(edge.innerId)) continue;
      queue.push({
        protocolIds: [...path.protocolIds, edge.innerId],
        edges: [...path.edges, edge],
      });
    }
  }
  return results;
}

export function bindingLabel(edge: EncapsulationEdge): string {
  if (edge.value === undefined) {
    return `${edge.namespaceName}${edge.conventional ? ' (conventional)' : ''}`;
  }
  const hexNamespace =
    edge.namespaceId.includes('ethertype') ||
    edge.namespaceId.includes('proto') ||
    edge.namespaceId.includes('pid');
  const assignment = hexNamespace
    ? `0x${edge.value.toString(16).toUpperCase().padStart(4, '0')}`
    : String(edge.value);
  return `${edge.namespaceName} ${assignment}${edge.conventional ? ' (conventional)' : ''}`;
}
