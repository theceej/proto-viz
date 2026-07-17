import { describe, expect, it } from 'vitest';
import { rfcUrl } from './refs';

describe('rfcUrl', () => {
  it('links RFC references and passes everything else through as null', () => {
    expect(rfcUrl('RFC 768')).toBe('https://www.rfc-editor.org/rfc/rfc768');
    expect(rfcUrl('RFC 9293')).toBe('https://www.rfc-editor.org/rfc/rfc9293');
    expect(rfcUrl('IEEE 802.3')).toBeNull();
    expect(rfcUrl('MS-SMB2')).toBeNull();
    expect(rfcUrl('3GPP TS 29.281')).toBeNull();
    expect(rfcUrl('Cisco CDP')).toBeNull();
  });
});
