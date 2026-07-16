import { describe, expect, it } from 'vitest';
import { findDiagrams } from './diagram';
import { camelCase, draftToDefinition, kebabCase } from './draft';
import { detectFormat } from './extract/detect';

describe('findDiagrams extras', () => {
  const SMALL = [
    '   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+',
    '   |             Alpha             |             Beta              |',
    '   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+',
  ].join('\n');

  it('parses ruler-less diagrams with a warning and reduced confidence', () => {
    const parses = findDiagrams(SMALL);
    expect(parses).toHaveLength(1);
    expect(parses[0]!.fields.map((f) => [f.name, f.bitLength])).toEqual([
      ['Alpha', 16],
      ['Beta', 16],
    ]);
    expect(parses[0]!.warnings.some((w) => w.includes('ruler'))).toBe(true);
    expect(parses[0]!.confidence).toBeLessThan(1);
  });

  it('finds multiple diagrams in one document', () => {
    const text = `First header:\n${SMALL}\n\nSecond header:\n${SMALL}\n`;
    expect(findDiagrams(text)).toHaveLength(2);
  });
});

describe('name casing helpers', () => {
  it('camelCase handles punctuation and empties', () => {
    expect(camelCase('Header Checksum')).toBe('headerChecksum');
    expect(camelCase('Type of Service')).toBe('typeOfService');
    expect(camelCase('QR')).toBe('qr');
    expect(camelCase('...')).toBe('');
  });

  it('kebabCase produces safe ids', () => {
    expect(kebabCase('My Custom Proto v2!')).toBe('my-custom-proto-v2');
    expect(kebabCase('$$$')).toBe('custom-protocol');
  });
});

describe('draftToDefinition', () => {
  it('turns variable fields into auto-length and stamps custom source', () => {
    const def = draftToDefinition(
      {
        name: 'X',
        confidence: 1,
        warnings: [],
        fields: [
          { id: 'a', name: 'A', bitLength: 16, type: 'uint', variable: false, flags: [] },
          { id: 'b', name: 'B', bitLength: 32, type: 'bytes', variable: true, flags: [] },
        ],
      },
      { id: 'x', name: 'X', layerHint: 'application', encapsulations: [{ namespaceId: 'udp-dstport', value: 9999 }] },
    );
    expect(def.source).toBe('custom');
    expect(def.fields[0]!.bitLength).toBe(16);
    expect(def.fields[1]!.bitLength).toBe('auto');
    expect(def.encapsulations[0]!.value).toBe(9999);
  });
});

describe('detectFormat', () => {
  const ascii = (s: string) => new TextEncoder().encode(s);

  it('detects by magic bytes', () => {
    expect(detectFormat('x.bin', ascii('%PDF-1.7 ...'))).toBe('pdf');
    expect(
      detectFormat('x.doc', Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
    ).toBe('doc-legacy');
    expect(detectFormat('x.docx', Uint8Array.from([0x50, 0x4b, 3, 4]))).toBe('docx');
  });

  it('detects HTML by content or extension', () => {
    expect(detectFormat('spec.bin', ascii('<!DOCTYPE html><html>'))).toBe('html');
    expect(detectFormat('spec.html', ascii('plain-ish'))).toBe('html');
  });

  it('treats printable content as text and binary junk as unknown', () => {
    expect(detectFormat('rfc791.txt', ascii('RFC 791\n\nHeader...'))).toBe('txt');
    expect(detectFormat('x.dat', Uint8Array.from({ length: 100 }, (_, i) => i % 7))).toBe(
      'unknown',
    );
  });

  it('flags legacy .doc by extension even without magic', () => {
    expect(detectFormat('spec.doc', ascii('who knows'))).toBe('doc-legacy');
  });
});
