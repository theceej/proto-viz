import { describe, expect, it } from 'vitest';
import { resolve, specUrl, type SpecSource } from './refs';

describe('specUrl', () => {
  it('links RFCs', () => {
    expect(specUrl('RFC 768')).toBe('https://www.rfc-editor.org/rfc/rfc768');
    expect(specUrl('RFC 9293')).toBe('https://www.rfc-editor.org/rfc/rfc9293');
  });

  it('links 3GPP TS specs by series+number', () => {
    expect(specUrl('3GPP TS 29.281')).toBe('https://www.3gpp.org/DynaReport/29281.htm');
  });

  it('links Microsoft Open Specifications by lowercased id', () => {
    expect(specUrl('MS-SMB2')).toBe(
      'https://learn.microsoft.com/openspecs/windows_protocols/ms-smb2/',
    );
  });

  it('links IEEE designations to the standards search', () => {
    expect(specUrl('IEEE 802.3')).toBe(
      'https://standards.ieee.org/search/?q=IEEE%20802.3',
    );
    expect(specUrl('IEEE 802.1AB')).toBe(
      'https://standards.ieee.org/search/?q=IEEE%20802.1AB',
    );
  });

  it('links known one-off references to their canonical source', () => {
    expect(specUrl('WireGuard whitepaper (Donenfeld)')).toBe(
      'https://www.wireguard.com/papers/wireguard.pdf',
    );
    expect(specUrl('MQTT 3.1.1 (OASIS)')).toContain('docs.oasis-open.org');
  });

  it('returns null for references with no known linkable source', () => {
    expect(specUrl('Cisco CDP')).toBeNull();
    expect(specUrl('Cisco NetFlow v5')).toBeNull();
    expect(specUrl('Modbus Application Protocol V1.1b3')).toBeNull();
    expect(specUrl('UPnP Device Architecture 2.0')).toBeNull();
  });
});

describe('resolve', () => {
  const source: SpecSource = {
    template: 'https://www.rfc-editor.org/rfc/rfc%s',
    match: /^RFC (\d+)$/,
    token: (m) => m[1]!,
    legacy: (base, t) => `${base.replace(/\/$/, '')}/rfc${t}`,
  };

  it('substitutes %s in a template override, arranging the id however the mirror needs', () => {
    expect(resolve({ ...source, override: 'https://mirror.example/rfcs/%s.txt' }, '768')).toBe(
      'https://mirror.example/rfcs/768.txt',
    );
  });

  it('substitutes every %s occurrence', () => {
    expect(resolve({ ...source, override: 'https://mirror.example/%s/rfc%s' }, '768')).toBe(
      'https://mirror.example/768/rfc768',
    );
  });

  it('treats a %s-less override as a legacy base URL (trailing slash trimmed)', () => {
    expect(
      resolve({ ...source, override: 'https://datatracker.ietf.org/doc/html/' }, '9293'),
    ).toBe('https://datatracker.ietf.org/doc/html/rfc9293');
  });

  it('falls back to the default template when no override is set', () => {
    expect(resolve(source, '768')).toBe('https://www.rfc-editor.org/rfc/rfc768');
  });
});
