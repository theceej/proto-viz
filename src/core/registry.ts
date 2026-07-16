import type { EnumTable, ProtocolDefinition } from './model';

/** Lookup for protocol definitions and enum tables (builtins + custom). */
export interface Registry {
  get(id: string): ProtocolDefinition | undefined;
  all(): ProtocolDefinition[];
  getEnum(id: string): EnumTable | undefined;
}

export function createRegistry(
  protocols: ProtocolDefinition[],
  enums: EnumTable[] = [],
): Registry {
  const byId = new Map(protocols.map((p) => [p.id, p]));
  const enumsById = new Map(enums.map((e) => [e.id, e]));
  return {
    get: (id) => byId.get(id),
    all: () => [...byId.values()],
    getEnum: (id) => enumsById.get(id),
  };
}
