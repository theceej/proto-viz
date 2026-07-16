import { describe, expect, it } from 'vitest';
import { newLayer, type StackInstance } from './model';
import { serializeStack } from './serialize';
import { LINKTYPE, writePcap } from './pcap';
import { planExport } from './exporter';
import { createBuiltinRegistry } from '../protocols';

const registry = createBuiltinRegistry();

describe('writePcap', () => {
  it('writes a correct global and record header', () => {
    const payload = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
    const file = writePcap([{ bytes: payload, tsSec: 1700000000, tsUsec: 1234 }], 1);
    const v = new DataView(file.buffer);

    expect(v.getUint32(0, true)).toBe(0xa1b2c3d4);
    expect(v.getUint16(4, true)).toBe(2);
    expect(v.getUint16(6, true)).toBe(4);
    expect(v.getUint32(16, true)).toBe(65535);
    expect(v.getUint32(20, true)).toBe(1); // linktype
    expect(v.getUint32(24, true)).toBe(1700000000);
    expect(v.getUint32(28, true)).toBe(1234);
    expect(v.getUint32(32, true)).toBe(4); // incl_len
    expect(v.getUint32(36, true)).toBe(4); // orig_len
    expect([...file.slice(40)]).toEqual([...payload]);
    expect(file.length).toBe(24 + 16 + 4);
  });

  it('embeds serialized packets back-to-back', () => {
    const s: StackInstance = { layers: ['ethernet', 'ipv4', 'icmp'].map(newLayer) };
    const pkt = serializeStack(s, registry).bytes;
    const file = writePcap(
      [
        { bytes: pkt, tsSec: 1, tsUsec: 0 },
        { bytes: pkt, tsSec: 1, tsUsec: 200 },
      ],
      LINKTYPE.ETHERNET,
    );
    expect(file.length).toBe(24 + 2 * (16 + pkt.length));
    expect([...file.slice(40, 40 + pkt.length)]).toEqual([...pkt]);
  });
});

describe('planExport', () => {
  const plan = (ids: string[]) => planExport({ layers: ids.map(newLayer) }, registry);

  it('uses LINKTYPE_ETHERNET for Ethernet-first stacks', () => {
    expect(plan(['ethernet', 'ipv4'])).toMatchObject({ ok: true, linkType: 1 });
  });

  it('uses LINKTYPE_RAW for IP-first stacks and offers wrapping', () => {
    expect(plan(['ipv4', 'udp'])).toMatchObject({
      ok: true,
      linkType: 101,
      canWrapInEthernet: true,
    });
  });

  it('blocks transport-first stacks with an actionable reason', () => {
    const p = plan(['tcp']);
    expect(p.ok).toBe(false);
    expect(p.blockedReason).toContain('transport');
  });

  it('blocks the empty stack', () => {
    expect(plan([]).ok).toBe(false);
  });
});
