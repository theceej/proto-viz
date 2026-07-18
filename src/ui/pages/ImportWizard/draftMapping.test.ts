import { describe, expect, it } from 'vitest';
import type { ProseField } from '../../../import/fieldList';
import { claimsToEncapsulations, proseToDraftFields } from './draftMapping';

describe('proseToDraftFields', () => {
  it('maps prose fields to uint drafts with stable ids and an inference note', () => {
    const prose: ProseField[] = [
      { name: 'Version', bits: 4, line: 1 },
      { name: 'Length', bits: 16, line: 2 },
    ];
    expect(proseToDraftFields(prose)).toEqual([
      { id: 'field0', name: 'Version', bitLength: 4, type: 'uint', variable: false, flags: [], inference: 'from prose field list' },
      { id: 'field1', name: 'Length', bitLength: 16, type: 'uint', variable: false, flags: [], inference: 'from prose field list' },
    ]);
  });

  it('returns an empty list for no prose fields', () => {
    expect(proseToDraftFields([])).toEqual([]);
  });
});

describe('claimsToEncapsulations', () => {
  it('drops rows without a namespace', () => {
    expect(
      claimsToEncapsulations([
        { namespaceId: '', value: '5' },
        { namespaceId: 'udp-dstport', value: '53' },
      ]),
    ).toEqual([{ namespaceId: 'udp-dstport', value: 53 }]);
  });

  it('treats a blank value as an opaque claim (undefined), not 0', () => {
    expect(claimsToEncapsulations([{ namespaceId: 'mpls-payload', value: '   ' }])).toEqual([
      { namespaceId: 'mpls-payload', value: undefined },
    ]);
  });

  it('parses hex and decimal values', () => {
    expect(
      claimsToEncapsulations([
        { namespaceId: 'ethertype', value: '0x0800' },
        { namespaceId: 'ip-proto', value: '6' },
      ]),
    ).toEqual([
      { namespaceId: 'ethertype', value: 0x0800 },
      { namespaceId: 'ip-proto', value: 6 },
    ]);
  });
});
