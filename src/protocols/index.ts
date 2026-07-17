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
import { ethernet8023 } from './ethernet8023';
import { stp } from './stp';
import { lldp } from './lldp';
import { vrrp } from './vrrp';
import { hsrp } from './hsrp';
import { ripv2 } from './ripv2';
import { eigrp } from './eigrp';
import { bfd } from './bfd';
import { dhcpv6 } from './dhcpv6';
import { tftp } from './tftp';
import { radius } from './radius';
import { netflow5 } from './netflow5';
import { rtp } from './rtp';
import { rtcp } from './rtcp';
import { stun } from './stun';
import { ipsecAh, ipsecEsp } from './ipsec';
import { websocket } from './websocket';
import { http2 } from './http2';
import { mqtt } from './mqtt';
import { coap } from './coap';
import { llmnr, mdns } from './mdns';
import { wireguard } from './wireguard';
import { geneve } from './geneve';
import { gtpu } from './gtpu';
import { modbus } from './modbus';
import { smb2 } from './smb2';

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
  ethernet8023,
  stp,
  lldp,
  vrrp,
  hsrp,
  ripv2,
  eigrp,
  bfd,
  dhcpv6,
  tftp,
  radius,
  netflow5,
  rtp,
  rtcp,
  stun,
  ipsecEsp,
  ipsecAh,
  websocket,
  http2,
  mqtt,
  coap,
  mdns,
  llmnr,
  wireguard,
  geneve,
  gtpu,
  modbus,
  smb2,
];

export { enumTables };

export function createBuiltinRegistry(custom: ProtocolDefinition[] = []): Registry {
  return createRegistry([...builtinProtocols, ...custom], enumTables);
}
