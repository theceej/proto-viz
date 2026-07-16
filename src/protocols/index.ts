import type { ProtocolDefinition } from '../core/model';
import { createRegistry, type Registry } from '../core/registry';
import { enumTables } from './enums';
import { ethernet } from './ethernet';
import { vlan8021q } from './vlan8021q';
import { ipv4 } from './ipv4';
import { udp } from './udp';
import { tcp } from './tcp';
import { icmp } from './icmp';

export const builtinProtocols: ProtocolDefinition[] = [
  ethernet,
  vlan8021q,
  ipv4,
  udp,
  tcp,
  icmp,
];

export { enumTables };

export function createBuiltinRegistry(custom: ProtocolDefinition[] = []): Registry {
  return createRegistry([...builtinProtocols, ...custom], enumTables);
}
