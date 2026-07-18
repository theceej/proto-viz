import type { FieldType, LayerHint } from '../../../core/model';

export type Step = 'upload' | 'pick' | 'review' | 'metadata';

export interface Claim {
  namespaceId: string;
  value: string;
}

export const FIELD_TYPES: FieldType[] = [
  'uint',
  'flags',
  'bytes',
  'mac',
  'ipv4',
  'ipv6',
  'string',
  'dnsName',
];

export const LAYER_HINTS: LayerHint[] = ['link', 'network', 'transport', 'application', 'tunnel'];

export const CLAIM_NAMESPACES = [
  { id: 'ethertype', label: 'Ethernet — EtherType', hex: true },
  { id: 'ip-proto', label: 'IPv4/IPv6 — IP Protocol number', hex: false },
  { id: 'udp-dstport', label: 'UDP — destination port', hex: false },
  { id: 'tcp-dstport', label: 'TCP — destination port', hex: false },
  { id: 'gre-proto', label: 'GRE — protocol type (EtherType-coded)', hex: true },
  { id: 'ppp-proto', label: 'PPPoE — PPP protocol number', hex: true },
];
