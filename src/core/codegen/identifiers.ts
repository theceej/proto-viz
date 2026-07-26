import type { CodeTarget } from './types';

const reserved: Record<CodeTarget, Set<string>> = {
  c: new Set(['auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extern', 'float', 'for', 'goto', 'if', 'inline', 'int', 'long', 'register', 'restrict', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union', 'unsigned', 'void', 'volatile', 'while']),
  scapy: new Set(['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield']),
  rust: new Set(['as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct', 'super', 'trait', 'true', 'type', 'union', 'unsafe', 'use', 'where', 'while']),
  'wireshark-lua': new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while']),
  go: new Set(['break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type', 'var']),
};

function words(input: string): string[] {
  return input.replace(/([a-z0-9])([A-Z])/g, '$1 $2').normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

export function identifier(input: string, target: CodeTarget, style: 'snake' | 'pascal' = 'snake'): string {
  const parts = words(input);
  let value = style === 'pascal'
    ? parts.map((part) => part[0]!.toUpperCase() + part.slice(1).toLowerCase()).join('')
    : parts.map((part) => part.toLowerCase()).join('_');
  if (!value) value = style === 'pascal' ? 'Protocol' : 'field';
  if (/^[0-9]/.test(value)) value = `_${value}`;
  if (reserved[target].has(value)) value += '_field';
  return value;
}

export function uniqueIdentifiers(inputs: string[], target: CodeTarget, style: 'snake' | 'pascal' = 'snake'): string[] {
  const used = new Set<string>();
  return inputs.map((input) => {
    const base = identifier(input, target, style);
    let result = base;
    let suffix = 2;
    while (used.has(result)) result = `${base}_${suffix++}`;
    used.add(result);
    return result;
  });
}

export function safeFilename(input: string): string {
  const value = words(input).map((part) => part.toLowerCase()).join('_');
  return (value || 'protocol').replace(/^\.+/, '') || 'protocol';
}
