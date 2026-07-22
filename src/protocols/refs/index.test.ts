import { describe, expect, it } from 'vitest';
import { referencesFor } from '.';
import { resolve, type ReferenceSource } from './sources';
import { builtinProtocols } from '..';

describe('protocol references', () => {
  it('merges multiple reference modules for one protocol in filename order', () => {
    expect(referencesFor('bfd')).toEqual([
      { name: 'RFC 5880', url: 'https://www.rfc-editor.org/rfc/rfc5880' },
      { name: 'RFC 5881', url: 'https://www.rfc-editor.org/rfc/rfc5881' },
    ]);
  });

  it('keeps legacy name-only references for custom protocols', () => {
    expect(referencesFor('my-protocol', ['Internal standard'])).toEqual([
      { name: 'Internal standard' },
    ]);
  });

  it('provides at least one full reference for every built-in protocol', () => {
    expect(
      builtinProtocols
        .filter((protocol) => referencesFor(protocol.id).length === 0)
        .map((protocol) => protocol.id),
    ).toEqual([]);
  });
});

describe('reference source mirrors', () => {
  const source: ReferenceSource = {
    template: 'https://www.rfc-editor.org/rfc/rfc%s',
    legacy: (base, token) => `${base.replace(/\/$/, '')}/rfc${token}`,
  };

  it('supports URL-template overrides', () => {
    expect(resolve({ ...source, override: 'https://mirror.example/%s.txt' }, '768')).toBe(
      'https://mirror.example/768.txt',
    );
  });

  it('supports legacy base-URL overrides', () => {
    expect(resolve({ ...source, override: 'https://mirror.example/' }, '768')).toBe(
      'https://mirror.example/rfc768',
    );
  });
});
