import { beforeEach, describe, expect, it } from 'vitest';
import { useStackStore } from './stackStore';

const store = () => useStackStore.getState();

beforeEach(() => {
  store().clear();
  store().clearHistory();
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

  it('undoes and redoes stack edits in order', () => {
    store().setStack(['ethernet', 'ipv4']);
    store().clearHistory();
    const original = store().layers;

    store().addLayer('tcp');
    const tcpUid = store().layers[2]!.uid;
    store().setOverride(tcpUid, 'sourcePort', 443);

    store().undo();
    expect(store().layers).toHaveLength(3);
    expect(store().layers[2]!.overrides).toEqual({});
    expect(store().canRedo).toBe(true);

    store().undo();
    expect(store().layers).toEqual(original);
    expect(store().canUndo).toBe(false);

    store().redo();
    store().redo();
    expect(store().layers[2]!.uid).toBe(tcpUid);
    expect(store().layers[2]!.overrides['sourcePort']).toBe(443);
  });

  it('coalesces consecutive edits to the same field', () => {
    store().setStack(['ipv4']);
    store().clearHistory();
    const uid = store().layers[0]!.uid;

    store().setOverride(uid, 'ttl', 1);
    store().setOverride(uid, 'ttl', 12);
    store().setOverride(uid, 'ttl', 123);
    store().undo();

    expect(store().layers[0]!.overrides).toEqual({});
    expect(store().canUndo).toBe(false);
    store().redo();
    expect(store().layers[0]!.overrides['ttl']).toBe(123);
  });

  it('treats a destructive stack load as one undo step', () => {
    store().setStack(['ethernet', 'ipv4', 'tcp'], Uint8Array.from([1, 2, 3]));
    const beforeLoad = store().layers;
    store().clearHistory();

    store().setStack(['ethernet', 'ipv4', 'udp', 'dns']);
    store().undo();

    expect(store().layers).toEqual(beforeLoad);
    expect([...store().trailingPayload]).toEqual([1, 2, 3]);
    expect(store().canUndo).toBe(false);
  });

  it('clears redo history after a new edit', () => {
    store().addLayer('ipv4');
    store().undo();
    expect(store().canRedo).toBe(true);

    store().addLayer('udp');
    expect(store().canRedo).toBe(false);
  });

  it('tracks payload edits as grouped history', () => {
    store().setPayload(Uint8Array.from([1]));
    store().setPayload(Uint8Array.from([1, 2]));
    store().undo();
    expect([...store().trailingPayload]).toEqual([]);
    store().redo();
    expect([...store().trailingPayload]).toEqual([1, 2]);
  });

  it('restores saved layers and replaces random layers as single steps', () => {
    store().setStack(['ethernet']);
    const saved = [{
      protocolId: 'ipv4',
      overrides: { ttl: 42, address: Uint8Array.from([1, 2]) },
      pinned: ['ttl'],
    }];
    store().clearHistory();

    store().restoreStack(saved, Uint8Array.from([3]));
    expect(store().layers[0]!.overrides['ttl']).toBe(42);
    expect(store().layers[0]!.pinned).toEqual(['ttl']);
    store().undo();
    expect(store().layers.map((layer) => layer.protocolId)).toEqual(['ethernet']);

    const replacement = store().layers.map((layer) => ({ ...layer, protocolId: 'udp' }));
    store().replaceLayers(replacement, Uint8Array.from([4]));
    expect(store().layers[0]!.protocolId).toBe('udp');
    store().undo();
    expect(store().layers[0]!.protocolId).toBe('ethernet');
  });

  it('ignores unavailable history and invalid structural edits', () => {
    store().undo();
    store().redo();
    store().removeLayer('missing');
    store().moveLayer(0, 0);
    expect(store().layers).toEqual([]);
    expect(store().canUndo).toBe(false);
  });
});
