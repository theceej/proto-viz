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

export function importLibraryJson(json: string): ProtocolDefinition[] {
  const data = JSON.parse(json, reviver) as {
    app?: string;
    version?: number;
    protocols?: ProtocolDefinition[];
  };
  if (!Array.isArray(data.protocols)) throw new Error('Not a proto-viz library file.');
  for (const p of data.protocols) {
    if (typeof p.id !== 'string' || !Array.isArray(p.fields))
      throw new Error('Library file contains an invalid protocol definition.');
    p.source = 'custom';
  }
  return data.protocols;
}
