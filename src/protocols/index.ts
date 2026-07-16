import type { ProtocolDefinition } from '../core/model';
import { createRegistry, type Registry } from '../core/registry';
import { enumTables } from './enums';
import { ethernet } from './ethernet';
import { vlan8021q } from './vlan8021q';
import { arp } from './arp';
import { ipv4 } from './ipv4';
import { ipv6 } from './ipv6';
import { icmp } from './icmp';
import { icmpv6 } from './icmpv6';
import { igmp } from './igmp';
import { tcp } from './tcp';
import { udp } from './udp';
import { sctp } from './sctp';
import { dns } from './dns';
import { dhcp } from './dhcp';
import { http1 } from './http1';
import { tls } from './tls';
import { ntp } from './ntp';
import { gre } from './gre';
import { vxlan } from './vxlan';
import { mpls } from './mpls';
import { ospf } from './ospf';
import { bgp } from './bgp';
import { pppoe } from './pppoe';
import { l2tp } from './l2tp';

export const builtinProtocols: ProtocolDefinition[] = [
  ethernet,
  vlan8021q,
  arp,
  ipv4,
  ipv6,
  icmp,
  icmpv6,
  igmp,
  tcp,
  udp,
  sctp,
  dns,
  dhcp,
  http1,
  tls,
  ntp,
  gre,
  vxlan,
  mpls,
  ospf,
  bgp,
  pppoe,
  l2tp,
];

export { enumTables };

export function createBuiltinRegistry(custom: ProtocolDefinition[] = []): Registry {
  return createRegistry([...builtinProtocols, ...custom], enumTables);
}
