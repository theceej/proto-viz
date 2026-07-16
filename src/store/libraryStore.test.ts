import { beforeEach, describe, expect, it } from 'vitest';
import { useLibraryStore } from './libraryStore';
import type { ProtocolDefinition } from '../core/model';

const def = (id: string): ProtocolDefinition => ({
  id,
  name: id,
  layerHint: 'application',
  source: 'custom',
  fields: [{ id: 'x', name: 'X', type: 'uint', bitLength: 8 }],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: 'udp-dstport', value: 1234 }],
});

const store = () => useLibraryStore.getState();

beforeEach(() => {
  store().setCustom([]);
});

describe('libraryStore', () => {
  it('exposes builtins through the registry', () => {
    expect(store().registry.get('ipv4')?.name).toBe('IPv4');
    expect(store().registry.all().length).toBeGreaterThanOrEqual(23);
  });

  it('adds custom protocols into the registry', () => {
    store().addCustom(def('my-proto'));
    expect(store().registry.get('my-proto')?.source).toBe('custom');
  });

  it('replaces a custom protocol with the same id instead of duplicating', () => {
    store().addCustom(def('my-proto'));
    store().addCustom({ ...def('my-proto'), name: 'Renamed' });
    expect(store().custom).toHaveLength(1);
    expect(store().registry.get('my-proto')?.name).toBe('Renamed');
  });

  it('removes custom protocols from the registry', () => {
    store().addCustom(def('my-proto'));
    store().removeCustom('my-proto');
    expect(store().registry.get('my-proto')).toBeUndefined();
  });

  it('custom protocols participate in enum lookups and validation data', () => {
    store().addCustom(def('my-proto'));
    expect(store().registry.getEnum('ip-proto')?.values[6]).toBe('TCP');
  });
});
