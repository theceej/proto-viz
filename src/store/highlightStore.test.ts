import { beforeEach, describe, expect, it } from 'vitest';
import { isActive, useHighlightStore } from './highlightStore';

const store = () => useHighlightStore.getState();

beforeEach(() => {
  useHighlightStore.setState({ hovered: null, locked: null });
});

describe('highlightStore', () => {
  it('tracks the hovered field', () => {
    store().setHovered({ layerUid: 'L1', fieldId: 'ttl' });
    expect(isActive(store().hovered, 'L1', 'ttl')).toBe(true);
    expect(isActive(store().hovered, 'L1', 'src')).toBe(false);
    expect(isActive(store().hovered, 'L2', 'ttl')).toBe(false);
    store().setHovered(null);
    expect(store().hovered).toBeNull();
  });

  it('toggleLocked pins and unpins the same field', () => {
    const ref = { layerUid: 'L1', fieldId: 'ttl' };
    store().toggleLocked(ref);
    expect(isActive(store().locked, 'L1', 'ttl')).toBe(true);
    store().toggleLocked({ ...ref });
    expect(store().locked).toBeNull();
  });

  it('locking a different field replaces the lock', () => {
    store().toggleLocked({ layerUid: 'L1', fieldId: 'ttl' });
    store().toggleLocked({ layerUid: 'L1', fieldId: 'src' });
    expect(isActive(store().locked, 'L1', 'src')).toBe(true);
    expect(isActive(store().locked, 'L1', 'ttl')).toBe(false);
  });
});
