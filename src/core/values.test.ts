import { describe, expect, it } from 'vitest';
import {
  encodeDnsName,
  formatIPv6,
  formatMac,
  parseIPv4,
  parseIPv6,
  parseMac,
} from './values';

describe('values', () => {
  it('parses and formats MAC addresses', () => {
    const b = parseMac('02:00:5e:10:00:ff');
    expect([...b]).toEqual([0x02, 0x00, 0x5e, 0x10, 0x00, 0xff]);
    expect(formatMac(b)).toBe('02:00:5e:10:00:ff');
    expect(() => parseMac('02:00:5e')).toThrow();
  });

  it('parses IPv4 addresses', () => {
    expect([...parseIPv4('192.0.2.1')]).toEqual([192, 0, 2, 1]);
    expect(() => parseIPv4('192.0.2.256')).toThrow();
    expect(() => parseIPv4('192.0.2')).toThrow();
  });

  it('parses IPv6 with :: compression', () => {
    expect([...parseIPv6('::1')]).toEqual([...new Uint8Array(15), 1]);
    const full = parseIPv6('2001:db8::8:800:200c:417a');
    expect(full[0]).toBe(0x20);
    expect(full[1]).toBe(0x01);
    expect(full[15]).toBe(0x7a);
    expect(() => parseIPv6('1:2:3:4:5:6:7:8:9')).toThrow();
  });

  it('formats IPv6 back with compression', () => {
    expect(formatIPv6(parseIPv6('2001:db8::1'))).toBe('2001:db8::1');
    expect(formatIPv6(parseIPv6('::'))).toBe('::');
  });

  it('encodes DNS names as labels', () => {
    expect([...encodeDnsName('example.com')]).toEqual([
      7, 101, 120, 97, 109, 112, 108, 101, 3, 99, 111, 109, 0,
    ]);
    expect([...encodeDnsName('')]).toEqual([0]);
  });
});
