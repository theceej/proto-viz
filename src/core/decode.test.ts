import { describe, expect, it } from 'vitest';
import { newLayer, type FieldDef, type StackInstance } from './model';
import { serializeStack, type FieldSpan } from './serialize';
import { decodePacket, readSpanValue } from './decode';
import { createBuiltinRegistry } from '../protocols';

const registry = createBuiltinRegistry();

const span = (bitOffset: number, bitLength: number): FieldSpan => ({
  layerUid: 'L',
  fieldId: 'f',
  bitOffset,
  bitLength,
  value: 0,
  computed: false,
  pinned: false,
});

const field = (type: FieldDef['type'], bitLength: FieldDef['bitLength']): FieldDef => ({
  id: 'f',
  name: 'F',
  type,
  bitLength,
});

describe('readSpanValue', () => {
  const bytes = Uint8Array.from([
    0x45, 0x02, 0xc0, 0x00, 0x02, 0x01, // 0x45, then odds and ends
    0x07, 0x65, 0x78, 0x61, 0x6d, 0x70, 0x6c, 0x65, 0x03, 0x63, 0x6f, 0x6d, 0x00,
  ]);

  it('reads sub-byte uints', () => {
    expect(readSpanValue(bytes, span(0, 4), field('uint', 4))).toBe(4);
    expect(readSpanValue(bytes, span(4, 4), field('uint', 4))).toBe(5);
  });

  it('reads >32-bit uints as bigint', () => {
    const v = readSpanValue(bytes, span(0, 48), field('uint', 48));
    expect(typeof v).toBe('bigint');
    expect(v).toBe(0x4502c0000201n);
  });

  it('reads addresses in display form', () => {
    expect(readSpanValue(bytes, span(16, 32), field('ipv4', 32))).toBe('192.0.2.1');
    expect(readSpanValue(bytes, span(0, 48), field('mac', 48))).toBe('45:02:c0:00:02:01');
  });

  it('decodes DNS names', () => {
    expect(readSpanValue(bytes, span(48, 13 * 8), field('dnsName', 'auto'))).toBe('example.com');
  });
});

describe('decodePacket', () => {
  it('decodes every span of a serialized stack', () => {
    const s: StackInstance = { layers: ['ethernet', 'ipv4', 'tcp'].map(newLayer) };
    const packet = serializeStack(s, registry);
    const decoded = decodePacket(packet, (uid, fieldId) => {
      const layer = s.layers.find((l) => l.uid === uid)!;
      return registry.get(layer.protocolId)!.fields.find((f) => f.id === fieldId);
    });
    expect(decoded.length).toBe(packet.spans.length);
    const src = decoded.find((d) => d.fieldId === 'src' && d.layerUid === s.layers[1]!.uid)!;
    expect(src.value).toBe('192.0.2.1');
  });
});
