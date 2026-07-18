import { describe, expect, it } from 'vitest';
import { newLayer } from './model';
import { planExport } from './exporter';
import { LINKTYPE } from './pcap';
import { createBuiltinRegistry } from '../protocols';

const registry = createBuiltinRegistry();
const plan = (ids: string[]) => planExport({ layers: ids.map(newLayer) }, registry);

describe('planExport edge cases', () => {
  it('IPv6-first stacks use LINKTYPE_RAW', () => {
    expect(plan(['ipv6', 'udp'])).toMatchObject({ ok: true, linkType: LINKTYPE.RAW });
  });

  it('802.3 and SNAP frames use the Ethernet link type', () => {
    expect(plan(['ethernet-8023', 'stp'])).toMatchObject({ ok: true, linkType: LINKTYPE.ETHERNET });
    expect(plan(['ethernet-snap', 'cdp'])).toMatchObject({ ok: true, linkType: LINKTYPE.ETHERNET });
  });

  it('non-Ethernet link layers fall back to USER0 with a wrap offer', () => {
    const p = plan(['pppoe', 'ipv4', 'udp']);
    expect(p.ok).toBe(true);
    expect(p.linkType).toBe(LINKTYPE.USER0);
    expect(p.canWrapInEthernet).toBe(true);
    expect(p.note).toContain('DLT_USER0');
  });

  it('a VLAN-first stack is exportable only via wrapping', () => {
    const p = plan(['vlan-8021q', 'ipv4']);
    expect(p.linkType).toBe(LINKTYPE.USER0);
    expect(p.canWrapInEthernet).toBe(true);
  });

  it('application-first stacks are blocked with an actionable reason', () => {
    const p = plan(['dns']);
    expect(p.ok).toBe(false);
    expect(p.blockedReason).toContain('application');
    expect(p.blockedReason).toContain('Add Ethernet');
  });

  it('unknown protocol at the head is reported, not thrown', () => {
    const p = planExport({ layers: [{ ...newLayer('ghost'), protocolId: 'ghost' }] }, registry);
    expect(p.ok).toBe(false);
    expect(p.blockedReason).toContain('ghost');
  });
});
