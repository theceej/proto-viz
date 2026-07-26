import { describe, expect, it } from 'vitest';
import type { FieldDef, ProtocolDefinition } from '../model';
import { builtinProtocols } from '../../protocols';
import { generateProtocolCode, type CodeTarget } from '.';

const targets: CodeTarget[] = ['c', 'scapy', 'rust', 'wireshark-lua', 'go'];

function protocol(fields: FieldDef[], id = 'test/protocol'): ProtocolDefinition {
  return {
    id,
    name: 'Test Protocol',
    layerHint: 'application',
    source: 'custom',
    fields,
    providesNamespaces: [],
    encapsulations: [],
  };
}

describe('generateProtocolCode', () => {
  it('maps fixed, sub-byte, and cross-byte fields to exact MSB-first offsets', () => {
    const definition = protocol([
      { id: 'version', name: 'Version', type: 'uint', bitLength: 3, default: 1 },
      { id: 'kind', name: 'Kind', type: 'uint', bitLength: 7, default: 2 },
      { id: 'value', name: 'Value', type: 'uint', bitLength: 14, default: 3 },
    ]);
    for (const target of targets) {
      const result = generateProtocolCode(definition, target);
      expect(result.code).toContain('offset=0 bits, width=3 bits');
      expect(result.code).toContain('offset=3 bits, width=7 bits');
      expect(result.code).toContain('offset=10 bits, width=14 bits');
      expect(result.code).toMatch(/MSB-first/);
    }
    expect(generateProtocolCode(definition, 'c').code).toContain('storage[3]');
  });

  it('retains conditions and expression, decode, and remainder widths as cursor logic', () => {
    const definition = protocol([
      { id: 'length', name: 'Length', type: 'uint', bitLength: 8 },
      { id: 'optional', name: 'Optional', type: 'uint', bitLength: 5, presentIf: { kind: 'field', fieldId: 'length' } },
      { id: 'body', name: 'Body', type: 'bytes', bitLength: { expr: { kind: 'field', fieldId: 'length' }, unit: 'bytes' } },
      { id: 'tail', name: 'Tail', type: 'bytes', bitLength: 'auto', decodeBitLength: { expr: { kind: 'const', value: 2 }, unit: 'bytes' } },
      { id: 'rest', name: 'Rest', type: 'bytes', bitLength: 'auto' },
    ]);
    for (const target of targets) {
      const result = generateProtocolCode(definition, target);
      expect(result.code).toMatch(/optional/i);
      expect(result.code).toContain('width=dynamic');
      expect(result.warnings).toContain('Rest: auto length is approximated as the remaining packet; trailing layout or payload boundary is unavailable.');
    }
    expect(generateProtocolCode(definition, 'scapy').code).toContain('ConditionalField');
    expect(generateProtocolCode(definition, 'go').code).toContain('cursor +=');
    expect(generateProtocolCode(definition, 'rust').code).toContain('checked_add');
  });

  it('covers all field types, flags, defaults, and computed metadata', () => {
    const definition = protocol([
      { id: 'uint', name: 'UInt', type: 'uint', bitLength: 8, default: 7 },
      { id: 'flags', name: 'Flags', type: 'flags', bitLength: 3, default: 2, flags: [{ bit: 1, name: 'Enabled' }] },
      { id: 'bytes', name: 'Bytes', type: 'bytes', bitLength: 8, default: new Uint8Array([1]) },
      { id: 'mac', name: 'MAC', type: 'mac', bitLength: 48, default: '02:00:00:00:00:01' },
      { id: 'ipv4', name: 'IPv4', type: 'ipv4', bitLength: 32, default: '192.0.2.1' },
      { id: 'ipv6', name: 'IPv6', type: 'ipv6', bitLength: 128, default: '2001:db8::1' },
      { id: 'string', name: 'String', type: 'string', bitLength: 8, default: 'a' },
      { id: 'dns', name: 'DNS', type: 'dnsName', bitLength: 8, default: '.' },
      { id: 'checksum', name: 'Checksum', type: 'uint', bitLength: 16, computed: { kind: 'checksum', algorithm: 'inet16', scope: 'header' } },
      { id: 'selector', name: 'Selector', type: 'uint', bitLength: 8, computed: { kind: 'binding' } },
      { id: 'size', name: 'Size', type: 'uint', bitLength: 8, computed: { kind: 'expr', expr: { kind: 'headerBytes' } } },
    ]);
    for (const target of targets) {
      const result = generateProtocolCode(definition, target);
      expect(result.code).toMatch(/checksum/i);
      expect(result.code).toMatch(/binding/i);
      expect(result.warnings.filter((warning) => /computed|checksum|binding/.test(warning))).toHaveLength(3);
    }
    expect(generateProtocolCode(definition, 'scapy').code).toContain('FlagsField');
    expect(generateProtocolCode(definition, 'scapy').code).toContain('MACField');
    expect(generateProtocolCode(definition, 'wireshark-lua').code).toContain('0x2');
    expect(generateProtocolCode(definition, 'c').code).toContain('#define TEST_PROTOCOL_FLAGS_ENABLED_MASK UINT64_C(0x2)');

    const wideMask = generateProtocolCode(protocol([
      { id: 'wide', name: 'Wide', type: 'flags', bitLength: 64, flags: [{ bit: 0, name: 'Top' }, { bit: 63, name: 'Bottom' }] },
    ]), 'c').code;
    expect(wideMask).toContain('#define TEST_PROTOCOL_WIDE_TOP_MASK UINT64_C(0x8000000000000000)');
    expect(wideMask).toContain('#define TEST_PROTOCOL_WIDE_BOTTOM_MASK UINT64_C(0x1)');
  });

  it('emits zerocopy storage for the fixed prefix and retains dynamic parsing', () => {
    const definition = protocol([
      { id: 'kind', name: 'Kind', type: 'uint', bitLength: 8 },
      { id: 'optional', name: 'Optional', type: 'uint', bitLength: 7, presentIf: { kind: 'field', fieldId: 'kind' } },
      { id: 'body', name: 'Body', type: 'bytes', bitLength: 'auto' },
    ]);
    const rust = generateProtocolCode(definition, 'rust').code;
    expect(rust).toContain('zerocopy = { version = "0.8", features = ["derive"] }');
    expect(rust).toContain('use zerocopy::{FromBytes, Immutable, IntoBytes, KnownLayout};');
    expect(rust).toContain('#[derive(FromBytes, IntoBytes, Immutable, KnownLayout)]');
    expect(rust).toContain('pub struct TestProtocolPrefix { pub storage: [u8; 1] }');
    expect(rust).toContain('PREFIX_BITS: usize = 8');
    expect(rust).toContain('checked_add');
  });

  it('uses Wireshark bitfield extraction for an unaligned 64-bit number', () => {
    const definition = protocol([
      { id: 'lead', name: 'Lead', type: 'uint', bitLength: 1 },
      { id: 'wide', name: 'Wide', type: 'uint', bitLength: 64 },
    ]);
    const lua = generateProtocolCode(definition, 'wireshark-lua').code;
    expect(lua).toContain('buffer():bitfield(cursor, wide_bits)');
    expect(lua).not.toContain('range:uint64()');
  });

  it('scans auto DNS names and reserves safe fixed trailing storage', () => {
    const definition = protocol([
      { id: 'name', name: 'Name', type: 'dnsName', bitLength: 'auto' },
      { id: 'data', name: 'Data', type: 'bytes', bitLength: 'auto' },
      { id: 'footer', name: 'Footer', type: 'uint', bitLength: 16 },
    ]);
    for (const target of targets) {
      const result = generateProtocolCode(definition, target);
      expect(result.code).toMatch(/dns.?name/i);
      expect(result.warnings.some((warning) => warning.startsWith('Name:'))).toBe(false);
      expect(result.warnings).toContain('Data: auto length is approximated as the remaining packet minus 16 statically sized trailing bits; the payload boundary is unavailable.');
    }
    expect(generateProtocolCode(definition, 'c').code).toContain('protocol_dns_name_bits');
    expect(generateProtocolCode(definition, 'scapy').code).toContain('ProtoVizDNSNameField');
  });

  it('warns when Scapy approximates dynamic numeric and flags fields', () => {
    const definition = protocol([
      { id: 'width', name: 'Width', type: 'uint', bitLength: 8 },
      { id: 'number', name: 'Number', type: 'uint', bitLength: { expr: { kind: 'field', fieldId: 'width' }, unit: 'bits' } },
      { id: 'flags', name: 'Flags', type: 'flags', bitLength: { expr: { kind: 'const', value: 4 }, unit: 'bits' } },
    ]);
    const scapy = generateProtocolCode(definition, 'scapy');
    expect(scapy.warnings).toContain('Number: Scapy approximates the expression-sized uint as byte-granular StrLenField data.');
    expect(scapy.warnings).toContain('Flags: Scapy approximates the expression-sized flags as byte-granular StrLenField data.');
    expect(scapy.code).toContain('WARNING: expression-sized uint is approximated as byte-granular bytes');
  });

  it('sanitizes reserved, invalid, and colliding identifiers deterministically', () => {
    const definition = protocol([
      { id: 'type', name: 'Type', type: 'uint', bitLength: 1 },
      { id: 'hello-world', name: 'One', type: 'uint', bitLength: 1 },
      { id: 'hello world', name: 'Two', type: 'uint', bitLength: 1 },
      { id: '123!', name: 'Three', type: 'uint', bitLength: 1 },
    ], '../../Bad Protocol');
    expect(generateProtocolCode(definition, 'rust').code).toContain('type_field');
    expect(generateProtocolCode(definition, 'go').code).toContain('HelloWorld_2');
    expect(generateProtocolCode(definition, 'c').code).toContain('_123');
    for (const target of targets) {
      const first = generateProtocolCode(definition, target);
      expect(generateProtocolCode(definition, target)).toEqual(first);
      expect(first.filename).not.toMatch(/[\\/]/);
    }
  });

  it('uses safe target filenames and MIME types', () => {
    const definition = protocol([], 'Demo Header');
    expect(targets.map((target) => generateProtocolCode(definition, target).filename)).toEqual([
      'demo_header.h', 'demo_header.py', 'demo_header.rs', 'demo_header.lua', 'demo_header.go',
    ]);
    expect(targets.map((target) => generateProtocolCode(definition, target).mimeType)).toEqual([
      'text/x-c', 'text/x-python', 'text/x-rust', 'text/x-lua', 'text/x-go',
    ]);
  });

  it('generates every built-in protocol for every target without throwing', () => {
    for (const definition of builtinProtocols) {
      for (const target of targets) {
        const result = generateProtocolCode(definition, target);
        expect(result.code.length, `${definition.id}/${target}`).toBeGreaterThan(200);
        expect(result.filename, `${definition.id}/${target}`).toMatch(/^[a-z0-9_]+\.(h|py|rs|lua|go)$/);
      }
    }
  });
});
