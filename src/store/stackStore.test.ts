import { beforeEach, describe, expect, it } from 'vitest';
import { useStackStore } from './stackStore';

const store = () => useStackStore.getState();

beforeEach(() => {
  store().clear();
});

describe('stackStore', () => {
  it('adds, inserts, and removes layers', () => {
    store().addLayer('ipv4');
    store().addLayer('tcp');
    store().insertLayer('ethernet', 0);
    expect(store().layers.map((l) => l.protocolId)).toEqual(['ethernet', 'ipv4', 'tcp']);
    store().removeLayer(store().layers[1]!.uid);
    expect(store().layers.map((l) => l.protocolId)).toEqual(['ethernet', 'tcp']);
  });

  it('gives duplicate protocols unique uids', () => {
    store().setStack(['ethernet', 'ipv4', 'ipv4']);
    const uids = store().layers.map((l) => l.uid);
    expect(new Set(uids).size).toBe(3);
  });

  it('moves layers and ignores out-of-range moves', () => {
    store().setStack(['ethernet', 'ipv4', 'tcp']);
    store().moveLayer(2, 1);
    expect(store().layers.map((l) => l.protocolId)).toEqual(['ethernet', 'tcp', 'ipv4']);
    store().moveLayer(9, 0); // no crash, no change
    expect(store().layers).toHaveLength(3);
  });

  it('sets and clears field overrides', () => {
    store().setStack(['ipv4']);
    const uid = store().layers[0]!.uid;
    store().setOverride(uid, 'ttl', 32);
    expect(store().layers[0]!.overrides['ttl']).toBe(32);
    store().clearOverride(uid, 'ttl');
    expect('ttl' in store().layers[0]!.overrides).toBe(false);
  });

  it('pin adds override + pinned entry; unpin removes both', () => {
    store().setStack(['ipv4']);
    const uid = store().layers[0]!.uid;
    store().pinField(uid, 'headerChecksum', 0x1234);
    expect(store().layers[0]!.pinned).toContain('headerChecksum');
    expect(store().layers[0]!.overrides['headerChecksum']).toBe(0x1234);
    store().pinField(uid, 'headerChecksum', 0x5678); // re-pin doesn't duplicate
    expect(store().layers[0]!.pinned.filter((p) => p === 'headerChecksum')).toHaveLength(1);
    store().unpinField(uid, 'headerChecksum');
    expect(store().layers[0]!.pinned).toEqual([]);
    expect('headerChecksum' in store().layers[0]!.overrides).toBe(false);
  });

  it('setStack replaces layers and payload atomically', () => {
    store().setStack(['ethernet'], Uint8Array.from([1, 2]));
    expect(store().layers).toHaveLength(1);
    expect([...store().trailingPayload]).toEqual([1, 2]);
    store().setStack(['ipv4']);
    expect(store().trailingPayload.length).toBe(0);
  });
});
