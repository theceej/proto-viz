import { describe, expect, it } from 'vitest';
import { newLayer } from './model';
import { serializeStack } from './serialize';
import { createBuiltinRegistry } from '../protocols';
import { decodeIpv4Options, encodeIpv4Options } from './ipv4Options';

describe('IPv4 options', () => {
  it('encodes Router Alert and Record Route byte-exactly with EOL padding', () => {
    const options = { routerAlert: 0, recordRoute: ['192.0.2.1', '198.51.100.1'] };
    const bytes = encodeIpv4Options(options);
    expect(bytes).toEqual(Uint8Array.from([0x94, 4, 0, 0, 7, 11, 4, 192, 0, 2, 1, 198, 51, 100, 1, 0]));
    expect(decodeIpv4Options(bytes)).toEqual(options);
  });

  it('round-trips timestamp and source-route options', () => {
    const options = { timestamps: [1, 0xffffffff], looseSourceRoute: ['203.0.113.1'], strictSourceRoute: ['192.0.2.2'] };
    expect(decodeIpv4Options(encodeIpv4Options(options))).toEqual(options);
  });

  it('updates IHL automatically and enforces the IPv4 maximum', () => {
    const ipv4 = newLayer('ipv4');
    ipv4.overrides.options = encodeIpv4Options({ routerAlert: 0 });
    const packet = serializeStack({ layers: [ipv4] }, createBuiltinRegistry());
    expect(packet.spans.find((span) => span.fieldId === 'ihl')?.value).toBe(6);
    expect(() => encodeIpv4Options({ recordRoute: Array(10).fill('192.0.2.1') })).toThrow('40 bytes');
  });

  it('preserves unknown options through the raw fallback', () => {
    expect(decodeIpv4Options(Uint8Array.from([0x9e, 4, 0, 0]))).toBeNull();
  });
});
