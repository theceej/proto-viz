import { describe, expect, it } from 'vitest';
import { newLayer, type StackInstance } from '../core/model';
import { serializeStack } from '../core/serialize';
import { decodeStackBytes } from '../core/decodeStack';
import { validateStack } from '../core/validate';
import { createBuiltinRegistry } from './index';

const registry = createBuiltinRegistry();

function taggedStack(inner = ['vlan-8021q', 'ipv4', 'udp']): StackInstance {
  const layers = ['ethernet', 'qinq', ...inner].map(newLayer);
  layers[1]!.overrides = { pcp: 5, dei: 1, vid: 2000 };
  if (inner[0] === 'vlan-8021q') layers[2]!.overrides = { pcp: 2, dei: 0, vid: 100 };
  return { layers, trailingPayload: new Uint8Array([0xde, 0xad, 0xbe, 0xef]) };
}

describe('QinQ provider bridging', () => {
  it('places the service TPID, independent tag bits, and customer TPID at their wire offsets', () => {
    const stack = taggedStack();
    const packet = serializeStack(stack, registry);
    expect([...packet.bytes.slice(12, 22)]).toEqual([
      0x88, 0xa8, // Ethernet identifies the service tag
      0xb7, 0xd0, // PCP 5, DEI 1, S-VID 2000
      0x81, 0x00, // service tag identifies the customer tag
      0x40, 0x64, // PCP 2, DEI 0, C-VID 100
      0x08, 0x00, // customer tag identifies IPv4
    ]);
    expect(packet.layers.map((layer) => layer.headerBytes)).toEqual([14, 4, 4, 20, 8]);
    expect(
      validateStack(stack, registry, packet).filter((issue) => issue.severity === 'error'),
    ).toEqual([]);
    const decoded = decodeStackBytes(packet.bytes, registry, 'ethernet');
    expect(decoded.layers.map((layer) => layer.protocolId)).toEqual(
      stack.layers.map((layer) => layer.protocolId),
    );
    expect(decoded.layers[1]!.overrides).toMatchObject({ pcp: 5, dei: 1, vid: 2000 });
    expect(decoded.layers[2]!.overrides).toMatchObject({ pcp: 2, dei: 0, vid: 100 });
    expect(decoded.payload).toEqual(stack.trailingPayload);
    expect(decoded.exact).toBe(true);
  });

  it('imports a legacy 0x9100 frame and preserves its TPID when re-exported', () => {
    const bytes = serializeStack(taggedStack(), registry).bytes.slice();
    bytes.set([0x91, 0x00], 12);
    const decoded = decodeStackBytes(bytes, registry, 'ethernet');
    expect(decoded.layers.map((layer) => layer.protocolId)).toEqual([
      'ethernet', 'qinq', 'vlan-8021q', 'ipv4', 'udp',
    ]);
    expect(decoded.layers[0]!.pinned).toContain('etherType');
    expect(decoded.layers[0]!.overrides.etherType).toBe(0x9100);
    expect(decoded.exact).toBe(true);
    expect(serializeStack(decoded.stack, registry).bytes).toEqual(bytes);
    expect(
      validateStack(decoded.stack, registry).filter((issue) => issue.severity === 'error'),
    ).toEqual([]);
  });

  it.each(['ipv4', 'ipv6', 'arp'])('can carry %s directly without a customer tag', (protocol) => {
    const stack = taggedStack([protocol]);
    const packet = serializeStack(stack, registry);
    const decoded = decodeStackBytes(packet.bytes, registry, 'ethernet');
    expect(decoded.layers.map((layer) => layer.protocolId)).toEqual([
      'ethernet', 'qinq', protocol,
    ]);
    expect(decoded.exact).toBe(true);
    expect(
      validateStack(stack, registry).filter((issue) => issue.severity === 'error'),
    ).toEqual([]);
  });
});
