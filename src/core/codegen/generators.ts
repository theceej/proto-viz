import type { Expr, FieldDef } from '../model';
import { identifier, safeFilename, uniqueIdentifiers } from './identifiers';
import { describeExpr, type InterpretedField, type InterpretedProtocol } from './interpret';
import type { GeneratedProtocolCode } from './types';

const byteTypes = new Set<FieldDef['type']>(['bytes', 'mac', 'ipv4', 'ipv6', 'string', 'dnsName']);

function banner(p: InterpretedProtocol, prefix: string): string[] {
  return [
    `${prefix} Generated from ${p.definition.name}. Fields are ordered MSB-first; bit 0 is the wire MSB.`,
    `${prefix} No repetition is inferred from a field's length or value.`,
    ...p.warnings.map((warning) => `${prefix} WARNING: ${warning}`),
  ];
}

function fieldComment(field: InterpretedField): string {
  const offset = field.bitOffset === null ? 'dynamic' : String(field.bitOffset);
  const width = field.fixedBitLength === null ? 'dynamic' : String(field.fixedBitLength);
  const defaultValue = formatDefault(field.definition.default);
  return `offset=${offset} bits, width=${width} bits, type=${field.definition.type}${defaultValue === null ? '' : `, default=${defaultValue}`}`;
}

function formatDefault(value: FieldDef['default']): string | null {
  if (value === undefined) return null;
  if (value instanceof Uint8Array) return `0x${[...value].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

function namesFor(p: InterpretedProtocol, target: 'c' | 'scapy' | 'rust' | 'wireshark-lua' | 'go'): Map<string, string> {
  const values = uniqueIdentifiers(p.fields.map((field) => field.definition.id), target, target === 'go' ? 'pascal' : 'snake');
  return new Map(p.fields.map((field, index) => [field.definition.id, values[index]!]));
}

function expression(expr: Expr, field: (id: string) => string, special: (kind: 'payloadBytes' | 'headerBytes') => string, div: (a: string, b: string) => string): string {
  switch (expr.kind) {
    case 'const': return String(expr.value);
    case 'field': return field(expr.fieldId);
    case 'payloadBytes': return special('payloadBytes');
    case 'headerBytes': return special('headerBytes');
    case 'binop': {
      const left = expression(expr.left, field, special, div);
      const right = expression(expr.right, field, special, div);
      return expr.op === 'div' ? div(left, right) : `(${left} ${expr.op} ${right})`;
    }
  }
}

function lengthExpr(
  field: InterpretedField,
  render: (expr: Expr) => string,
  availableBits: string,
  subtract: (available: string, trailing: number) => string,
  dnsNameBits: string,
): string {
  const length = field.decodeLength;
  if (typeof length === 'number') return String(length);
  if (length === 'remainder') return availableBits;
  if (length === 'dnsName') return dnsNameBits;
  if ('trailingBits' in length) return subtract(availableBits, length.trailingBits);
  const value = render(length.expr);
  return length.unit === 'bytes' ? `((${value}) * 8)` : `(${value})`;
}

function computedComment(field: FieldDef): string {
  if (!field.computed) return '';
  if (field.computed.kind === 'checksum') return `; computed checksum ${field.computed.algorithm}/${field.computed.scope}`;
  if (field.computed.kind === 'binding') return '; computed payload binding';
  return `; computed expression ${describeExpr(field.computed.expr)}`;
}

export function generateC(p: InterpretedProtocol): GeneratedProtocolCode {
  const n = namesFor(p, 'c');
  const base = safeFilename(p.definition.id);
  const typeName = identifier(p.definition.name, 'c');
  const fixedBytes = p.fixedBitLength === null ? null : Math.ceil(p.fixedBitLength / 8);
  const lines = [...banner(p, '/*').map((line) => `${line} */`),
    '#pragma once', '#include <stdbool.h>', '#include <stddef.h>', '#include <stdint.h>', '',
    'typedef struct { const uint8_t *ptr; size_t bit_offset; size_t bit_length; } protocol_slice;',
    'static inline uint64_t protocol_mask(size_t width) { return width >= 64 ? UINT64_MAX : ((UINT64_C(1) << width) - 1u); }',
    'static inline bool protocol_read_bits(const uint8_t *data, size_t size, size_t off, size_t width, uint64_t *out) {',
    '  if (width > 64 || off > size * 8 || width > size * 8 - off) return false;',
    '  uint64_t value = 0; for (size_t i = 0; i < width; ++i) value = (value << 1) | ((data[(off+i)/8] >> (7-((off+i)%8))) & 1u);',
    '  *out = value; return true;', '}',
    'static inline bool protocol_dns_name_bits(const uint8_t *data, size_t size, size_t off, size_t *width) {',
    '  if (off % 8 != 0) return false; size_t pos = off / 8;',
    '  while (pos < size) { uint8_t label = data[pos++]; if (label == 0) { *width = pos * 8 - off; return true; }',
    '    if ((label & 0xc0u) == 0xc0u) { if (pos >= size) return false; ++pos; *width = pos * 8 - off; return true; }',
    '    if (label > 63 || (size_t)label > size - pos) return false; pos += label;',
    '  } return false;', '}', ''];
  const flagInputs = p.fields.flatMap((field) => (field.definition.flags ?? []).map((flag) => `${p.definition.id}_${field.definition.id}_${flag.name}`));
  const flagNames = uniqueIdentifiers(flagInputs, 'c').map((name) => name.toUpperCase());
  let flagIndex = 0;
  for (const field of p.fields) {
    for (const flag of field.definition.flags ?? []) {
      const name = flagNames[flagIndex++]!;
      if (field.fixedBitLength !== null && field.fixedBitLength <= 64 && flag.bit < field.fixedBitLength) {
        const mask = 1n << BigInt(field.fixedBitLength - 1 - flag.bit);
        lines.push(`#define ${name}_MASK UINT64_C(0x${mask.toString(16)})`);
      } else {
        lines.push(`#define ${name}_MASK(width) (((width) > ${flag.bit}u && (width) <= 64u) ? (UINT64_C(1) << ((width) - 1u - ${flag.bit}u)) : UINT64_C(0))`);
      }
    }
  }
  if (flagNames.length) lines.push('');
  if (fixedBytes !== null && fixedBytes > 0) {
    lines.push(`#pragma pack(push, 1)`, `typedef struct { uint8_t storage[${fixedBytes}]; } ${typeName}_storage;`, '#pragma pack(pop)', '');
  }
  lines.push(`typedef struct {`, '  const uint8_t *data;', '  size_t size;');
  for (const field of p.fields) {
    const name = n.get(field.definition.id)!;
    lines.push(`  bool has_${name};`);
    lines.push(byteTypes.has(field.definition.type) ? `  protocol_slice ${name};` : `  uint64_t ${name};`);
  }
  lines.push(`} ${typeName}_view;`, '', `static inline bool ${typeName}_parse(${typeName}_view *v, const uint8_t *data, size_t size) {`,
    '  size_t cursor = 0; uint64_t value = 0; v->data = data; v->size = size;');
  const cExpr = (expr: Expr) => expression(expr, (id) => `v->${n.get(id) ?? identifier(id, 'c')}`, (kind) => kind === 'payloadBytes' ? '(size - (cursor / 8))' : '((cursor + 7) / 8)', (a, b) => `((${b}) == 0 ? 0 : (${a}) / (${b}))`);
  for (const field of p.fields) {
    const def = field.definition;
    const name = n.get(def.id)!;
    const width = lengthExpr(field, cExpr, '(size * 8 - cursor)', (available, trailing) => `((${available}) >= ${trailing} ? (${available}) - ${trailing} : 0)`, `${name}_bits`);
    lines.push(`  /* ${def.name}: ${fieldComment(field)}${computedComment(def)} */`, `  v->has_${name} = false;`);
    if (def.presentIf) lines.push(`  if (${cExpr(def.presentIf)}) {`);
    const pad = def.presentIf ? '    ' : '  ';
    if (field.decodeLength === 'dnsName') lines.push(`${pad}size_t ${name}_bits = 0;`, `${pad}if (!protocol_dns_name_bits(data, size, cursor, &${name}_bits)) return false;`);
    else lines.push(`${pad}size_t ${name}_bits = (size_t)(${width});`);
    lines.push(`${pad}if (cursor > size * 8 || ${name}_bits > size * 8 - cursor) return false;`);
    if (byteTypes.has(def.type)) {
      lines.push(`${pad}v->${name}.ptr = data + cursor / 8; v->${name}.bit_offset = cursor % 8; v->${name}.bit_length = ${name}_bits;`);
    } else {
      lines.push(`${pad}if (!protocol_read_bits(data, size, cursor, ${name}_bits, &value)) return false;`, `${pad}v->${name} = value;`);
    }
    lines.push(`${pad}v->has_${name} = true;`, `${pad}cursor += ${name}_bits;`);
    if (def.flags?.length) for (const flag of def.flags) lines.push(`${pad}/* flag ${flag.name}: mask is 1 << (${name}_bits - 1 - ${flag.bit}) */`);
    if (def.presentIf) lines.push('  }');
  }
  lines.push('  return true;', '}');
  return { code: `${lines.join('\n')}\n`, filename: `${base}.h`, mimeType: 'text/x-c', warnings: p.warnings };
}

function pyString(value: string): string { return JSON.stringify(value); }

export function generateScapy(p: InterpretedProtocol): GeneratedProtocolCode {
  const n = namesFor(p, 'scapy');
  const cls = identifier(p.definition.name, 'scapy', 'pascal');
  const base = safeFilename(p.definition.id);
  const dynamicNumeric = p.fields.filter((field) => typeof field.decodeLength !== 'number' && !byteTypes.has(field.definition.type));
  const byteGranularity = p.fields.filter((field) => {
    if (!byteTypes.has(field.definition.type) || field.decodeLength === 'dnsName') return false;
    if (typeof field.decodeLength === 'number') return field.bitOffset === null || field.bitOffset % 8 !== 0 || field.decodeLength % 8 !== 0;
    if (field.decodeLength === 'remainder') return field.bitOffset === null || field.bitOffset % 8 !== 0;
    if ('trailingBits' in field.decodeLength) return field.decodeLength.trailingBits % 8 !== 0 || field.bitOffset === null || field.bitOffset % 8 !== 0;
    return field.decodeLength.unit === 'bits';
  });
  const warnings = [...p.warnings,
    ...dynamicNumeric.map((field) => `${field.definition.name}: Scapy approximates the expression-sized ${field.definition.type} as byte-granular StrLenField data.`),
    ...byteGranularity.map((field) => `${field.definition.name}: Scapy's string field is byte-granular and may approximate this bit-level offset or width.`),
  ];
  const pyExpr = (expr: Expr) => expression(expr, (id) => `getattr(pkt, ${pyString(n.get(id) ?? identifier(id, 'scapy'))}, 0)`, (kind) => kind === 'payloadBytes' ? 'len(bytes(pkt.payload))' : 'len(bytes(pkt))', (a, b) => `(${a} // ${b} if ${b} else 0)`);
  const lines = [...banner({ ...p, warnings }, '#'), 'from scapy.packet import Packet',
    'from scapy.fields import BitField, ConditionalField, FieldLenField, FlagsField, IP6Field, IPField, MACField, StrField, StrLenField', '',
    'class ProtoVizDNSNameField(StrField):',
    '    def getfield(self, pkt, data):',
    '        pos = 0',
    '        while pos < len(data):',
    '            label = data[pos]',
    '            pos += 1',
    '            if label == 0:',
    '                return data[pos:], self.m2i(pkt, data[:pos])',
    '            if label & 0xC0 == 0xC0:',
    '                if pos >= len(data): raise ValueError("truncated DNS compression pointer")',
    '                pos += 1',
    '                return data[pos:], self.m2i(pkt, data[:pos])',
    '            if label > 63 or pos + label > len(data): raise ValueError("invalid DNS name")',
    '            pos += label',
    '        raise ValueError("unterminated DNS name")', '',
    `class ${cls}(Packet):`, `    name = ${pyString(p.definition.fullName ?? p.definition.name)}`, '    fields_desc = ['];
  for (const field of p.fields) {
    const def = field.definition;
    const name = n.get(def.id)!;
    const defaultValue = typeof def.default === 'number' ? String(def.default) : typeof def.default === 'string' ? pyString(def.default) : byteTypes.has(def.type) ? "b''" : '0';
    let fieldCode: string;
    if (field.decodeLength === 'dnsName') {
      fieldCode = `ProtoVizDNSNameField(${pyString(name)}, ${defaultValue})`;
    } else if (typeof field.decodeLength !== 'number') {
      const length = field.decodeLength === 'remainder' ? null : field.decodeLength;
      let callback = '';
      if (length && 'trailingBits' in length) callback = `length_from=lambda pkt: max(0, len(pkt.original) - ${Math.ceil(length.trailingBits / 8)})`;
      else if (length) callback = `length_from=lambda pkt: (${pyExpr(length.expr)})${length.unit === 'bits' ? ' // 8' : ''}`;
      fieldCode = callback ? `StrLenField(${pyString(name)}, ${defaultValue}, ${callback})` : `StrField(${pyString(name)}, ${defaultValue})`;
    } else if (def.type === 'mac' && field.decodeLength === 48) fieldCode = `MACField(${pyString(name)}, ${defaultValue})`;
    else if (def.type === 'ipv4' && field.decodeLength === 32) fieldCode = `IPField(${pyString(name)}, ${defaultValue})`;
    else if (def.type === 'ipv6' && field.decodeLength === 128) fieldCode = `IP6Field(${pyString(name)}, ${defaultValue})`;
    else if (byteTypes.has(def.type) || field.decodeLength % 8 === 0 && field.decodeLength > 64) fieldCode = `StrLenField(${pyString(name)}, ${defaultValue}, length_from=lambda pkt: ${Math.ceil(field.decodeLength / 8)})`;
    else if (def.type === 'flags') {
      const labels = (def.flags ?? []).slice().sort((a, b) => a.bit - b.bit).map((flag) => pyString(flag.name));
      fieldCode = `FlagsField(${pyString(name)}, ${defaultValue}, ${field.decodeLength}, [${labels.join(', ')}])`;
    } else fieldCode = `BitField(${pyString(name)}, ${defaultValue}, ${field.decodeLength})`;
    if (def.presentIf) fieldCode = `ConditionalField(${fieldCode}, lambda pkt: bool(${pyExpr(def.presentIf)}))`;
    lines.push(`        # ${fieldComment(field)}${computedComment(def)}`);
    if (dynamicNumeric.includes(field)) {
      lines.push(`        # WARNING: expression-sized ${def.type} is approximated as byte-granular bytes, not a numeric Scapy field.`);
    } else if (byteGranularity.includes(field)) {
      lines.push('        # WARNING: Scapy string fields are byte-granular; this bit-level layout may be approximated.');
    } else if (typeof field.decodeLength !== 'number' && field.decodeLength !== 'remainder' && field.decodeLength !== 'dnsName' && !('trailingBits' in field.decodeLength) && field.decodeLength.unit === 'bits') {
      lines.push('        # WARNING: Scapy string lengths are byte-granular; a non-byte-aligned runtime width is rounded down.');
    }
    lines.push(`        ${fieldCode},`);
  }
  lines.push('    ]', '', '# Bind this Packet with bind_layers(...) for the appropriate transport/selector context.');
  return { code: `${lines.join('\n')}\n`, filename: `${base}.py`, mimeType: 'text/x-python', warnings };
}

export function generateRust(p: InterpretedProtocol): GeneratedProtocolCode {
  const n = namesFor(p, 'rust');
  const cls = identifier(p.definition.name, 'rust', 'pascal');
  const base = safeFilename(p.definition.id);
  const prefixBytes = Math.ceil(p.fixedPrefixBitLength / 8);
  const lines = [...banner(p, '//'), '// Cargo.toml: zerocopy = { version = "0.8", features = ["derive"] }',
    'use zerocopy::{FromBytes, Immutable, IntoBytes, KnownLayout};', ''];
  if (prefixBytes > 0) {
    lines.push('#[repr(C)]', '#[derive(FromBytes, IntoBytes, Immutable, KnownLayout)]',
      `pub struct ${cls}Prefix { pub storage: [u8; ${prefixBytes}] }`,
      `pub const ${identifier(p.definition.name, 'rust').toUpperCase()}_PREFIX_BITS: usize = ${p.fixedPrefixBitLength};`,
      '// If PREFIX_BITS is not byte-aligned, unused low bits of the last storage byte belong to the following dynamic field.', '');
  }
  lines.push(
    '#[derive(Debug, Clone, Copy)]', `pub struct ${cls}Field<'a> { pub bytes: &'a [u8], pub bit_offset: usize, pub bit_length: usize }`,
    '#[derive(Debug)]', `pub struct ${cls}View<'a> {`);
  for (const field of p.fields) lines.push(`    /// ${fieldComment(field)}${computedComment(field.definition)}`, `    pub ${n.get(field.definition.id)!}: Option<${cls}Field<'a>>,`);
  lines.push('}', '', 'fn read_bits(data: &[u8], offset: usize, width: usize) -> Option<u64> {',
    '    if width > 64 || offset.checked_add(width)? > data.len() * 8 { return None; }',
    '    let mut value = 0u64; for bit in offset..offset + width { value = (value << 1) | u64::from((data[bit / 8] >> (7 - bit % 8)) & 1); } Some(value)', '}',
    'fn dns_name_bits(data: &[u8], offset: usize) -> Option<usize> {',
    '    if offset % 8 != 0 { return None; } let mut pos = offset / 8;',
    '    while pos < data.len() { let label = data[pos]; pos += 1; if label == 0 { return Some(pos * 8 - offset); }',
    '        if label & 0xc0 == 0xc0 { if pos >= data.len() { return None; } pos += 1; return Some(pos * 8 - offset); }',
    '        if label > 63 || pos.checked_add(label as usize)? > data.len() { return None; } pos += label as usize;',
    '    } None', '}', '',
    `impl<'a> ${cls}View<'a> {`, `    pub fn parse(data: &'a [u8]) -> Result<Self, &'static str> {`, '        let mut cursor = 0usize;');
  const rExpr = (expr: Expr) => expression(expr, (id) => `read_bits(data, ${n.get(id) ?? identifier(id, 'rust')}_offset, ${n.get(id) ?? identifier(id, 'rust')}_bits).unwrap_or(0) as usize`, (kind) => kind === 'payloadBytes' ? '(data.len() - cursor / 8)' : '((cursor + 7) / 8)', (a, b) => `(if ${b} == 0 { 0 } else { ${a} / ${b} })`);
  for (const field of p.fields) {
    const name = n.get(field.definition.id)!;
    const width = lengthExpr(field, rExpr, '(data.len() * 8 - cursor)', (available, trailing) => `(${available}).saturating_sub(${trailing})`, `dns_name_bits(data, cursor).ok_or("invalid DNS name")?`);
    lines.push(`        let ${name}_offset = cursor;`, `        let ${name}_present = ${field.definition.presentIf ? `${rExpr(field.definition.presentIf)} != 0` : 'true'};`,
      `        let ${name}_bits = if ${name}_present { ${width} } else { 0 };`, `        if cursor.checked_add(${name}_bits).filter(|n| *n <= data.len() * 8).is_none() { return Err("truncated ${name}"); }`,
      `        let ${name} = ${name}_present.then_some(${cls}Field { bytes: data, bit_offset: cursor, bit_length: ${name}_bits });`, `        cursor += ${name}_bits;`);
  }
  lines.push('        Ok(Self {', ...p.fields.map((field) => `            ${n.get(field.definition.id)!},`), '        })', '    }', '}', '',
    `// Call read_bits(view.FIELD.unwrap().bytes, view.FIELD.unwrap().bit_offset, ...) for numeric values.`,
    '// The zerocopy prefix covers the statically positioned leading storage; the cursor parser retains every dynamic field.');
  return { code: `${lines.join('\n')}\n`, filename: `${base}.rs`, mimeType: 'text/x-rust', warnings: p.warnings };
}

export function generateLua(p: InterpretedProtocol): GeneratedProtocolCode {
  const n = namesFor(p, 'wireshark-lua');
  const base = safeFilename(p.definition.id);
  const proto = identifier(p.definition.id, 'wireshark-lua');
  const flagEntries = p.fields.flatMap((field) => (field.definition.flags ?? []).map((flag, index) => ({ field, flag, index })));
  const luaFlagNames = uniqueIdentifiers(flagEntries.map(({ field, flag }) => `${n.get(field.definition.id)!}_${flag.name}`), 'wireshark-lua');
  const flagName = new Map(flagEntries.map((entry, index) => [`${entry.field.index}:${entry.index}`, luaFlagNames[index]!]));
  const lines = [...banner(p, '--'), `local ${proto} = Proto(${JSON.stringify(base)}, ${JSON.stringify(p.definition.fullName ?? p.definition.name)})`, 'local f = {}'];
  for (const field of p.fields) {
    const name = n.get(field.definition.id)!;
    const kind = byteTypes.has(field.definition.type) ? 'bytes' : 'uint64';
    lines.push(`-- ${fieldComment(field)}${computedComment(field.definition)}`, `f.${name} = ProtoField.${kind}(${JSON.stringify(`${base}.${name}`)}, ${JSON.stringify(field.definition.name)})`);
    for (const [flagIndex, flag] of (field.definition.flags ?? []).entries()) {
      const width = field.fixedBitLength ?? 8;
      const mask = flag.bit < width && width <= 52 ? `0x${(2 ** (width - 1 - flag.bit)).toString(16)}` : 'nil';
      const generatedName = flagName.get(`${field.index}:${flagIndex}`)!;
      lines.push(`f.${generatedName} = ProtoField.bool(${JSON.stringify(`${base}.${generatedName}`)}, ${JSON.stringify(flag.name)}, ${width}, nil, ${mask})`);
    }
  }
  lines.push(`${proto}.fields = f`, '',
    'local function dns_name_bits(buffer, cursor)',
    '  if cursor % 8 ~= 0 then return nil end',
    '  local pos = math.floor(cursor / 8)',
    '  while pos < buffer:len() do',
    '    local label = buffer(pos, 1):uint(); pos = pos + 1',
    '    if label == 0 then return pos * 8 - cursor end',
    '    if label >= 192 then if pos >= buffer:len() then return nil end; return (pos + 1) * 8 - cursor end',
    '    if label > 63 or pos + label > buffer:len() then return nil end; pos = pos + label',
    '  end',
    '  return nil',
    'end', '',
    `function ${proto}.dissector(buffer, pinfo, tree)`, `  pinfo.cols.protocol = ${JSON.stringify(p.definition.name)}`, `  local root = tree:add(${proto}, buffer())`, '  local cursor = 0', '  local values = {}');
  const lExpr = (expr: Expr) => expression(expr, (id) => `(values.${n.get(id) ?? identifier(id, 'wireshark-lua')} or 0)`, (kind) => kind === 'payloadBytes' ? '(buffer:len() - math.floor(cursor / 8))' : 'math.ceil(cursor / 8)', (a, b) => `(${b} == 0 and 0 or math.floor(${a} / ${b}))`);
  for (const field of p.fields) {
    const name = n.get(field.definition.id)!;
    const width = lengthExpr(field, lExpr, '(buffer:len() * 8 - cursor)', (available, trailing) => `math.max(0, (${available}) - ${trailing})`, 'dns_name_bits(buffer, cursor)');
    if (field.definition.presentIf) lines.push(`  if ${lExpr(field.definition.presentIf)} ~= 0 then`);
    const pad = field.definition.presentIf ? '    ' : '  ';
    lines.push(`${pad}local ${name}_bits = ${width}`, `${pad}if ${name}_bits == nil or cursor + ${name}_bits > buffer:len() * 8 then root:add_expert_info(PI_MALFORMED, PI_ERROR, "Truncated or invalid ${name}"); return end`,
      `${pad}local byte_off, byte_len = math.floor(cursor / 8), math.ceil((cursor % 8 + ${name}_bits) / 8)`, `${pad}local range = buffer(byte_off, byte_len)`);
    if (!byteTypes.has(field.definition.type)) {
      lines.push(`${pad}local wire_value = buffer():bitfield(cursor, ${name}_bits)`,
        `${pad}values.${name} = type(wire_value) == "userdata" and wire_value:tonumber() or wire_value`, `${pad}root:add(f.${name}, range, wire_value)`);
      for (const [flagIndex] of (field.definition.flags ?? []).entries()) lines.push(`${pad}root:add(f.${flagName.get(`${field.index}:${flagIndex}`)!}, range, wire_value)`);
    } else lines.push(`${pad}root:add(f.${name}, range)`);
    lines.push(`${pad}cursor = cursor + ${name}_bits`);
    if (field.definition.presentIf) lines.push('  end');
  }
  lines.push('end', '', `return ${proto}`, `-- Register with DissectorTable.get("udp.port"):add(PORT, ${proto}) or the appropriate table.`);
  return { code: `${lines.join('\n')}\n`, filename: `${base}.lua`, mimeType: 'text/x-lua', warnings: p.warnings };
}

export function generateGo(p: InterpretedProtocol): GeneratedProtocolCode {
  const n = namesFor(p, 'go');
  const cls = identifier(p.definition.name, 'go', 'pascal');
  const pkg = identifier(p.definition.id, 'go');
  const base = safeFilename(p.definition.id);
  const lines = [...banner(p, '//'), `package ${pkg}`, '', 'import (', '    "encoding/binary"', '    "fmt"', ')', '',
    'type FieldView struct { Bytes []byte; BitOffset, BitLength int }', `type ${cls} struct {`];
  for (const field of p.fields) lines.push(`    // ${fieldComment(field)}${computedComment(field.definition)}`, `    ${n.get(field.definition.id)!} *FieldView`);
  lines.push('}', '', 'func readBits(data []byte, off, width int) (uint64, bool) {',
    '    if width < 0 || width > 64 || off < 0 || off+width > len(data)*8 { return 0, false }',
    '    if width == 16 && off%8 == 0 { return uint64(binary.BigEndian.Uint16(data[off/8:])), true }',
    '    if width == 32 && off%8 == 0 { return uint64(binary.BigEndian.Uint32(data[off/8:])), true }',
    '    if width == 64 && off%8 == 0 { return binary.BigEndian.Uint64(data[off/8:]), true }',
    '    var value uint64; for bit := off; bit < off+width; bit++ { value = value<<1 | uint64((data[bit/8]>>uint(7-bit%8))&1) }; return value & bitMask(width), true', '}',
    'func bitMask(width int) uint64 { if width >= 64 { return ^uint64(0) }; return (uint64(1) << uint(width)) - 1 }', '',
    'func dnsNameBits(data []byte, off int) (int, bool) {',
    '    if off%8 != 0 { return 0, false }; pos := off/8',
    '    for pos < len(data) { label := data[pos]; pos++; if label == 0 { return pos*8-off, true }',
    '        if label&0xc0 == 0xc0 { if pos >= len(data) { return 0, false }; pos++; return pos*8-off, true }',
    '        if label > 63 || pos+int(label) > len(data) { return 0, false }; pos += int(label)',
    '    }; return 0, false', '}', '',
    `func Parse(data []byte) (*${cls}, error) {`, `    out := &${cls}{}`, '    cursor := 0', '    values := map[string]uint64{}');
  const gExpr = (expr: Expr) => expression(expr, (id) => `int(values[${JSON.stringify(id)}])`, (kind) => kind === 'payloadBytes' ? '(len(data) - cursor/8)' : '((cursor + 7) / 8)', (a, b) => `func() int { if ${b} == 0 { return 0 }; return ${a} / ${b} }()`);
  for (const field of p.fields) {
    const name = n.get(field.definition.id)!;
    const width = lengthExpr(field, gExpr, '(len(data)*8 - cursor)', (available, trailing) => `func() int { n := (${available}) - ${trailing}; if n < 0 { return 0 }; return n }()`, `func() int { n, ok := dnsNameBits(data, cursor); if !ok { return -1 }; return n }()`);
    if (field.definition.presentIf) lines.push(`    if ${gExpr(field.definition.presentIf)} != 0 {`);
    const pad = field.definition.presentIf ? '        ' : '    ';
    lines.push(`${pad}${name}Bits := int(${width})`, `${pad}if ${name}Bits < 0 || cursor+${name}Bits > len(data)*8 { return nil, fmt.Errorf("truncated ${field.definition.id}") }`,
      `${pad}out.${name} = &FieldView{Bytes: data, BitOffset: cursor, BitLength: ${name}Bits}`);
    if (!byteTypes.has(field.definition.type)) lines.push(`${pad}if value, ok := readBits(data, cursor, ${name}Bits); ok { values[${JSON.stringify(field.definition.id)}] = value } else { return nil, fmt.Errorf("invalid ${field.definition.id} width") }`);
    lines.push(`${pad}cursor += ${name}Bits`);
    if (field.definition.presentIf) lines.push('    }');
  }
  lines.push('    return out, nil', '}', '', '// Selectors/bindings and checksum validation require caller-provided payload context.');
  return { code: `${lines.join('\n')}\n`, filename: `${base}.go`, mimeType: 'text/x-go', warnings: p.warnings };
}
