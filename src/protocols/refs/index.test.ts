import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  compareReferenceFilenames,
  parseReferenceFilename,
  referenceModulePaths,
  referencesFor,
} from '.';
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

describe('reference filenames', () => {
  const parse = (name: string) => parseReferenceFilename(`./${name}`);

  it('accepts a protocol and an index of any length', () => {
    expect(parse('foo.1.ts')).toEqual({ protocolId: 'foo', qualifier: '', index: 1 });
    expect(parse('foo.100.ts')).toEqual({ protocolId: 'foo', qualifier: '', index: 100 });
  });

  it('accepts an optional qualifier naming where the references came from', () => {
    expect(parse('foo.bar.1.ts')).toEqual({ protocolId: 'foo', qualifier: 'bar', index: 1 });
    expect(parse('foo.bar.200.ts')).toEqual({ protocolId: 'foo', qualifier: 'bar', index: 200 });
  });

  it('keeps hyphenated protocol ids intact', () => {
    // Ids use hyphens and never dots, which is what makes the qualifier
    // unambiguous — `ikev2-natt` is one id, not an id plus a qualifier.
    expect(parse('ikev2-natt.1.ts')?.protocolId).toBe('ikev2-natt');
    expect(parse('ethernet-8023.acme.2.ts')).toEqual({
      protocolId: 'ethernet-8023',
      qualifier: 'acme',
      index: 2,
    });
  });

  it('rejects the modules that are not references', () => {
    for (const name of ['index.ts', 'types.ts', 'sources.ts', 'foo.ts', 'foo.bar.ts'])
      expect(parse(name)).toBeNull();
  });

  it('discovers every file on disk that the grammar accepts', () => {
    // The glob and the regex are two statements of the same rule, and only the
    // regex is directly testable. Narrowing the glob — back to a single digit,
    // say — would leave every test above passing while qualified files silently
    // stopped loading, so compare what it found against the directory itself.
    const onDisk = readdirSync(new URL('.', import.meta.url))
      .filter((name) => parseReferenceFilename(`./${name}`))
      .sort();

    expect(onDisk.length).toBeGreaterThan(0);
    expect([...referenceModulePaths]).toEqual(onDisk);
  });

  it('orders a protocol’s own references before any qualifier, and n numerically', () => {
    const order = ['foo.acme.10.ts', 'foo.2.ts', 'foo.acme.2.ts', 'foo.10.ts', 'foo.zeta.1.ts']
      .map((name) => ({ name, parsed: parse(name)! }))
      .sort((a, b) => compareReferenceFilenames(a.parsed, b.parsed))
      .map(({ name }) => name);

    expect(order).toEqual([
      'foo.2.ts',
      'foo.10.ts',
      'foo.acme.2.ts',
      'foo.acme.10.ts',
      'foo.zeta.1.ts',
    ]);
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
