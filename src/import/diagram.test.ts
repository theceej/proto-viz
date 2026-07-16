import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { findDiagrams } from './diagram';
import { findProseFields } from './fieldList';
import { buildDraft } from './draft';

const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8');

describe('findDiagrams', () => {
  it('parses the RFC 791 IPv4 header exactly', () => {
    const parses = findDiagrams(fixture('rfc791-ipv4.txt'));
    expect(parses).toHaveLength(1);
    const d = parses[0]!;
    expect(d.bitsPerRow).toBe(32);
    expect(d.totalBits).toBe(192);
    expect(d.confidence).toBeGreaterThan(0.8);
    expect(
      d.fields.map((f) => [f.name, f.bitOffset, f.bitLength]),
    ).toEqual([
      ['Version', 0, 4],
      ['IHL', 4, 4],
      ['Type of Service', 8, 8],
      ['Total Length', 16, 16],
      ['Identification', 32, 16],
      ['Flags', 48, 3],
      ['Fragment Offset', 51, 13],
      ['Time to Live', 64, 8],
      ['Protocol', 72, 8],
      ['Header Checksum', 80, 16],
      ['Source Address', 96, 32],
      ['Destination Address', 128, 32],
      ['Options', 160, 24],
      ['Padding', 184, 8],
    ]);
  });

  it('parses RFC 768 UDP (1-char-per-bit style, increasing ruler)', () => {
    const parses = findDiagrams(fixture('rfc768-udp.txt'));
    expect(parses.length).toBeGreaterThanOrEqual(1);
    const d = parses[0]!;
    expect(d.bitsPerRow).toBe(32);
    const named = d.fields.map((f) => [f.name, f.bitLength]);
    expect(named).toContainEqual(['Source Port', 16]);
    expect(named).toContainEqual(['Destination Port', 16]);
    expect(named).toContainEqual(['Length', 16]);
    expect(named).toContainEqual(['Checksum', 16]);
  });

  it('parses the RFC 1035 DNS header (16-bit rows)', () => {
    const parses = findDiagrams(fixture('rfc1035-dns.txt'));
    expect(parses).toHaveLength(1);
    const d = parses[0]!;
    expect(d.bitsPerRow).toBe(16);
    expect(d.totalBits).toBe(96);
    const byName = new Map(d.fields.map((f) => [f.name, f]));
    expect(byName.get('ID')!.bitLength).toBe(16);
    expect(byName.get('QR')!.bitLength).toBe(1);
    expect(byName.get('Opcode')!.bitLength).toBe(4);
    expect(byName.get('Z')!.bitLength).toBe(3);
    expect(byName.get('RCODE')!.bitLength).toBe(4);
    expect(byName.get('QDCOUNT')!.bitOffset).toBe(32);
  });

  it('parses the TCP header with multi-line flag cells', () => {
    const parses = findDiagrams(fixture('rfc9293-tcp.txt'));
    expect(parses).toHaveLength(1);
    const d = parses[0]!;
    const byOffset = new Map(d.fields.map((f) => [f.bitOffset, f]));
    expect(byOffset.get(0)!.name).toBe('Source Port');
    expect(byOffset.get(96)!.name).toContain('Data');
    expect(byOffset.get(96)!.bitLength).toBe(4);
    // eight single-bit flags at offsets 104..111
    for (let bit = 104; bit < 112; bit++) {
      expect(byOffset.get(bit)!.bitLength, `flag at ${bit}`).toBe(1);
    }
    expect(byOffset.get(112)!.name).toBe('Window');
    expect(byOffset.get(112)!.bitLength).toBe(16);
  });

  it('gives malformed diagrams a low confidence and flags fields', () => {
    const parses = findDiagrams(fixture('malformed.txt'));
    expect(parses).toHaveLength(1);
    const d = parses[0]!;
    expect(d.confidence).toBeLessThan(0.7);
    expect(d.fields.some((f) => f.flags.includes('misaligned'))).toBe(true);
  });

  it('finds nothing in plain prose', () => {
    expect(findDiagrams('Just some text.\nNo diagrams here.\n')).toEqual([]);
  });
});

describe('findProseFields', () => {
  it('extracts "Name: N bits" declarations from RFC prose', () => {
    const fields = findProseFields(fixture('rfc791-ipv4.txt'));
    expect(fields).toContainEqual({ name: 'Version', bits: 4, line: expect.any(Number) });
    expect(fields).toContainEqual({ name: 'IHL', bits: 4, line: expect.any(Number) });
  });
});

describe('buildDraft', () => {
  it('infers types and generates unique ids', () => {
    const parse = findDiagrams(fixture('rfc791-ipv4.txt'))[0]!;
    const draft = buildDraft(parse, 'IPv4 (imported)');
    const byId = new Map(draft.fields.map((f) => [f.id, f]));
    expect(byId.get('sourceAddress')!.type).toBe('ipv4');
    expect(byId.get('destinationAddress')!.type).toBe('ipv4');
    expect(byId.get('version')!.type).toBe('uint');
    expect(draft.fields).toHaveLength(14);
  });
});
