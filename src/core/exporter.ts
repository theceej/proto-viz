/** Decides how a stack maps onto a pcap link type. */
import type { StackInstance } from './model';
import type { Registry } from './registry';
import { LINKTYPE } from './pcap';

export interface ExportPlan {
  ok: boolean;
  linkType?: number;
  linkTypeName?: string;
  note?: string;
  blockedReason?: string;
  /** The stack could be exported by prepending an Ethernet header. */
  canWrapInEthernet?: boolean;
}

export function planExport(stack: StackInstance, registry: Registry): ExportPlan {
  const first = stack.layers[0];
  if (!first) return { ok: false, blockedReason: 'The stack is empty.' };
  const def = registry.get(first.protocolId);
  if (!def) return { ok: false, blockedReason: `Unknown protocol "${first.protocolId}".` };

  if (def.id === 'ethernet' || def.id === 'ethernet-8023' || def.id === 'ethernet-snap') {
    return { ok: true, linkType: LINKTYPE.ETHERNET, linkTypeName: 'LINKTYPE_ETHERNET (1)' };
  }

  if (def.id === 'ipv4' || def.id === 'ipv6') {
    return {
      ok: true,
      linkType: LINKTYPE.RAW,
      linkTypeName: 'LINKTYPE_RAW (101)',
      note: 'The capture starts at the IP header. Most tools handle this fine; wrap in Ethernet for maximum compatibility.',
      canWrapInEthernet: true,
    };
  }

  // Anything that can legally sit inside Ethernet can be exported by wrapping.
  const wrappable = def.encapsulations.some((e) => e.namespaceId === 'ethertype');
  if (def.layerHint === 'link') {
    return {
      ok: true,
      linkType: LINKTYPE.USER0,
      linkTypeName: 'LINKTYPE_USER0 (147)',
      note: 'Non-Ethernet link layer: Wireshark needs a DLT_USER0 protocol mapping to dissect this.',
      canWrapInEthernet: wrappable,
    };
  }

  return {
    ok: false,
    blockedReason: `pcap needs a link- or network-layer frame at the start; ${def.name} is a ${def.layerHint}-layer protocol. Add Ethernet and/or IP beneath it.`,
    canWrapInEthernet: wrappable,
  };
}
