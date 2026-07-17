import { describe, expect, it } from 'vitest';
import {
  MAX_SHARE_LAYERS,
  SHARE_PROTOCOL_IDS,
  ShareCodeError,
  decodeShare,
  encodeShare,
} from './share';
import { createBuiltinRegistry } from '../protocols';
import { mulberry32, randomStack } from './random';

describe('share codes', () => {
  it('covers every built-in protocol with stable, frozen positions', () => {
    const registry = createBuiltinRegistry();
    for (const id of SHARE_PROTOCOL_IDS) expect(registry.get(id)).toBeDefined();
    for (const def of registry.all()) {
      if (def.source === 'builtin') expect(SHARE_PROTOCOL_IDS).toContain(def.id);
    }
    // Positions are baked into issued codes — spot-pin them so an accidental
    // reorder of the table fails loudly.
    expect(SHARE_PROTOCOL_IDS[0]).toBe('ethernet');
    expect(SHARE_PROTOCOL_IDS[3]).toBe('ipv4');
    expect(SHARE_PROTOCOL_IDS[8]).toBe('tcp');
    expect(SHARE_PROTOCOL_IDS[22]).toBe('l2tp');
  });

  it('round-trips representative stacks', () => {
    const stacks = [
      ['ethernet'],
      ['ethernet', 'ipv4', 'tcp'],
      ['ethernet', 'ipv4', 'udp', 'dns'],
      ['ethernet', 'vlan-8021q', 'vlan-8021q', 'ipv4', 'udp'],
      ['ethernet', 'ipv4', 'udp', 'vxlan', 'ethernet', 'ipv4', 'udp'],
      ['ethernet', 'ipv4', 'tcp', 'tls', 'http1'],
      [...SHARE_PROTOCOL_IDS].slice(0, MAX_SHARE_LAYERS),
    ];
    for (const ids of stacks) {
      expect(decodeShare(encodeShare(ids))).toEqual(ids);
    }
  });

  it('keeps codes as short as the stack allows', () => {
    expect(encodeShare(['ethernet', 'ipv4', 'tcp']).split('.')).toHaveLength(3);
    expect(
      encodeShare(['ethernet', 'ipv4', 'udp', 'vxlan', 'ethernet', 'ipv4', 'udp']).split('.'),
    ).toHaveLength(5);
  });

  it('codes are stable across releases (golden values)', () => {
    // Changing the encoding, wordlist, or protocol table would orphan every
    // code ever shared — these goldens must never change.
    expect(encodeShare(['ethernet', 'ipv4', 'tcp'])).toBe('army.borrow.advice');
    expect(encodeShare(['ethernet', 'ipv4', 'udp', 'dns'])).toBe(
      'avoid.bottom.regular.length',
    );
    expect(decodeShare('army.borrow.advice')).toEqual(['ethernet', 'ipv4', 'tcp']);
  });

  it('uses format v1 for expanded-library stacks and round-trips them', () => {
    const expanded = ['ethernet', 'ipv4', 'udp', 'wireguard'];
    const code = encodeShare(expanded);
    expect(decodeShare(code)).toEqual(expanded);
    // 4 layers at 7 bits + header + crc = 42 bits -> 4 words
    expect(code.split('.')).toHaveLength(4);
    expect(decodeShare(encodeShare(['ethernet-8023', 'stp']))).toEqual([
      'ethernet-8023',
      'stp',
    ]);
    // classic stacks stay on the short v0 format
    expect(encodeShare(['ethernet', 'ipv4', 'tcp']).split('.')).toHaveLength(3);
  });

  it('round-trips 300 random valid stacks', () => {
    const registry = createBuiltinRegistry();
    for (let seed = 1; seed <= 300; seed++) {
      const ids = randomStack(registry, { rng: mulberry32(seed) }).layers.map(
        (l) => l.protocolId,
      );
      expect(decodeShare(encodeShare(ids))).toEqual(ids);
    }
  });

  it('accepts sloppy input: case, separators, and 4-letter prefixes', () => {
    const code = encodeShare(['ethernet', 'ipv4', 'udp', 'dns']);
    const words = code.split('.');
    expect(decodeShare(words.join(' / ').toUpperCase())).toEqual([
      'ethernet',
      'ipv4',
      'udp',
      'dns',
    ]);
    expect(decodeShare(words.map((w) => w.slice(0, 4)).join(' '))).toEqual([
      'ethernet',
      'ipv4',
      'udp',
      'dns',
    ]);
  });

  it('rejects tampered codes', () => {
    const words = encodeShare(['ethernet', 'ipv4', 'tcp']).split('.');
    // Swap each word for a neighbour in the list; the CRC (or structure
    // checks) must catch every one of these single-word substitutions.
    for (let i = 0; i < words.length; i++) {
      const tampered = [...words];
      tampered[i] = tampered[i] === 'abandon' ? 'ability' : 'abandon';
      expect(() => decodeShare(tampered.join('.'))).toThrow(ShareCodeError);
    }
    expect(() => decodeShare(words.slice(0, -1).join('.'))).toThrow(ShareCodeError);
    expect(() => decodeShare([...words, 'zoo'].join('.'))).toThrow(ShareCodeError);
  });

  it('rejects unknown words, empty input, and non-shareable stacks', () => {
    expect(() => decodeShare('definitely notbip39 words')).toThrow(/not a word/);
    expect(() => decodeShare('')).toThrow(ShareCodeError);
    expect(() => decodeShare('  .  ')).toThrow(ShareCodeError);
    expect(() => encodeShare([])).toThrow(/at least one layer/);
    expect(() => encodeShare(['my-custom-proto'])).toThrow(/built-in/);
    expect(() =>
      encodeShare(Array.from({ length: MAX_SHARE_LAYERS + 1 }, () => 'ipv4')),
    ).toThrow(/longer than/);
  });
});
