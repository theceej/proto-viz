import { describe, expect, it } from 'vitest';
import type { ProtocolDefinition } from './model';
import { createLibrarySearchIndex } from './librarySearch';

const ethernet: ProtocolDefinition = {
  id: 'ethernet',
  name: 'Ethernet II',
  layerHint: 'link',
  source: 'builtin',
  fields: [
    {
      id: 'etherType',
      name: 'EtherType',
      type: 'uint',
      bitLength: 16,
      description: 'Identifies the payload protocol.',
    },
  ],
  providesNamespaces: [
    { id: 'ethertype', displayName: 'EtherType', selectorFieldId: 'etherType' },
  ],
  encapsulations: [],
};

const ipv6: ProtocolDefinition = {
  id: 'ipv6',
  name: 'IPv6',
  fullName: 'Internet Protocol version 6',
  layerHint: 'network',
  source: 'custom',
  references: ['RFC 8200'],
  fields: [
    { id: 'payloadLength', name: 'Payload Length', type: 'uint', bitLength: 16 },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: 'ethertype', value: 0x86dd }],
};

const dns: ProtocolDefinition = {
  id: 'dns',
  name: 'DNS',
  layerHint: 'application',
  source: 'builtin',
  fields: [{ id: 'checksumHint', name: 'Checksum hint', type: 'uint', bitLength: 8 }],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: 'udp-dstport', value: 53 }],
};

const udp: ProtocolDefinition = {
  id: 'udp',
  name: 'UDP',
  layerHint: 'transport',
  source: 'builtin',
  fields: [],
  providesNamespaces: [
    { id: 'udp-dstport', displayName: 'UDP destination port', selectorFieldId: 'dstPort' },
  ],
  encapsulations: [],
};

const index = createLibrarySearchIndex(
  [ethernet, ipv6, udp, dns],
  (_protocolId, names = []) => names.map((name) => ({ name })),
);

describe('library structured search', () => {
  it('normalizes hexadecimal and decimal assignment values', () => {
    const hex = index.search('0x86dd')[0]!;
    const decimal = index.search('34525')[0]!;
    expect(hex).toMatchObject({ kind: 'assignment', protocolId: 'ipv6' });
    expect(decimal.key).toBe(hex.key);
  });

  it('prioritizes namespace-qualified exact assignments', () => {
    expect(index.search('udp 53')[0]).toMatchObject({
      kind: 'assignment',
      protocolId: 'dns',
    });
    expect(index.search('ethertype 0x86dd')[0]).toMatchObject({
      kind: 'assignment',
      protocolId: 'ipv6',
    });
  });

  it('indexes fields with a navigable field id', () => {
    expect(index.search('checksum')[0]).toMatchObject({
      kind: 'field',
      protocolId: 'dns',
      fieldId: 'checksumHint',
    });
  });

  it('indexes custom protocol names and fallback references', () => {
    expect(index.search('RFC 8200')[0]).toMatchObject({
      kind: 'reference',
      protocolId: 'ipv6',
    });
    expect(index.search('internet protocol version 6')[0]).toMatchObject({
      kind: 'protocol',
      protocolId: 'ipv6',
    });
  });
});
