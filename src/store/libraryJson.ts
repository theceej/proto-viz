/**
 * JSON export/import of custom protocol definitions for backup and sharing.
 * Uint8Array field defaults are encoded as {"$bytes": "<base64>"}.
 */
import type { ProtocolDefinition } from '../core/model';

const BYTES_TAG = '$bytes';

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array) {
    let bin = '';
    for (const b of value) bin += String.fromCharCode(b);
    return { [BYTES_TAG]: btoa(bin) };
  }
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (
    value !== null &&
    typeof value === 'object' &&
    BYTES_TAG in value &&
    typeof (value as Record<string, unknown>)[BYTES_TAG] === 'string'
  ) {
    const bin = atob((value as Record<string, string>)[BYTES_TAG]!);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }
  return value;
}

export function exportLibraryJson(defs: ProtocolDefinition[]): string {
  return JSON.stringify({ app: 'proto-viz', version: 1, protocols: defs }, replacer, 2);
}

// Sanity caps for imported (untrusted) definitions. Way above anything a
// real protocol needs, low enough that a hostile file can't hang the tab.
const MAX_PROTOCOLS = 500;
const MAX_FIELDS = 1024;
const MAX_FIELD_BITS = 1 << 20;
const MAX_NAME_LENGTH = 200;
const MAX_LINT_RULES = 128;

export function importLibraryJson(json: string): ProtocolDefinition[] {
  const data = JSON.parse(json, reviver) as {
    app?: string;
    version?: number;
    protocols?: ProtocolDefinition[];
  };
  if (!Array.isArray(data.protocols)) throw new Error('Not a proto-viz library file.');
  if (data.protocols.length > MAX_PROTOCOLS)
    throw new Error(`Library file has ${data.protocols.length} protocols; the limit is ${MAX_PROTOCOLS}.`);
  for (const p of data.protocols) {
    if (
      typeof p.id !== 'string' ||
      p.id.length === 0 ||
      p.id.length > MAX_NAME_LENGTH ||
      typeof p.name !== 'string' ||
      p.name.length > MAX_NAME_LENGTH ||
      !Array.isArray(p.fields) ||
      p.fields.length > MAX_FIELDS ||
      !Array.isArray(p.encapsulations) ||
      !Array.isArray(p.providesNamespaces)
    ) {
      throw new Error('Library file contains an invalid protocol definition.');
    }
    for (const f of p.fields) {
      const lengthOk =
        f.bitLength === 'auto' ||
        (typeof f.bitLength === 'number' &&
          Number.isInteger(f.bitLength) &&
          f.bitLength >= 0 &&
          f.bitLength <= MAX_FIELD_BITS) ||
        (typeof f.bitLength === 'object' && f.bitLength !== null && 'expr' in f.bitLength);
      if (typeof f.id !== 'string' || typeof f.name !== 'string' || !lengthOk) {
        throw new Error(`Library file contains an invalid field definition in "${p.id}".`);
      }
    }
    if (p.lintRules !== undefined) {
      if (!Array.isArray(p.lintRules) || p.lintRules.length > MAX_LINT_RULES) {
        throw new Error(`Library file contains invalid semantic lint rules in "${p.id}".`);
      }
      const fieldIds = new Set(p.fields.map((field) => field.id));
      for (const rule of p.lintRules) {
        const commonValid =
          rule !== null &&
          typeof rule === 'object' &&
          fieldIds.has(rule.fieldId) &&
          (rule.severity === 'warning' || rule.severity === 'advisory') &&
          typeof rule.code === 'string' &&
          rule.code.length > 0 &&
          rule.code.length <= MAX_NAME_LENGTH &&
          typeof rule.message === 'string' &&
          rule.message.length > 0 &&
          rule.message.length <= 1000 &&
          (rule.reference === undefined ||
            (typeof rule.reference === 'string' && rule.reference.length <= 500));
        if (!commonValid || !lintRuleShapeValid(rule)) {
          throw new Error(`Library file contains an invalid semantic lint rule in "${p.id}".`);
        }
      }
    }
    p.source = 'custom';
  }
  return data.protocols;
}

function lintRuleShapeValid(
  rule: NonNullable<ProtocolDefinition['lintRules']>[number],
): boolean {
  switch (rule.kind) {
    case 'value':
      return (
        (rule.operator === 'equals' || rule.operator === 'notEquals') &&
        Number.isFinite(rule.value)
      );
    case 'bitsClear':
      return Number.isSafeInteger(rule.mask) && rule.mask >= 0;
    case 'incompatibleBits':
      return (
        Number.isSafeInteger(rule.leftMask) &&
        rule.leftMask > 0 &&
        Number.isSafeInteger(rule.rightMask) &&
        rule.rightMask > 0
      );
    case 'sourceAddress':
      return rule.family === 'ipv4' || rule.family === 'ipv6';
    case 'zeroWhenCarriedBy':
      return typeof rule.protocolId === 'string' && rule.protocolId.length <= MAX_NAME_LENGTH;
    case 'payloadBindingMismatch':
    case 'wellKnownPayload':
      return true;
    default:
      return false;
  }
}
