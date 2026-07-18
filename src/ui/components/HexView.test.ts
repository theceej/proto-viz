// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SerializedPacket } from '../../core/serialize';
import { useHighlightStore } from '../../store/highlightStore';
import HexView from './HexView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const packet: SerializedPacket = {
  bytes: Uint8Array.from({ length: 20 }, (_, index) => index),
  spans: [
    {
      layerUid: 'ipv4-1',
      fieldId: 'header',
      bitOffset: 0,
      bitLength: 144,
      value: new Uint8Array(18),
      computed: false,
      pinned: false,
    },
  ],
  layers: [{ uid: 'ipv4-1', protocolId: 'ipv4', byteOffset: 0, headerBytes: 18 }],
  payloadOffset: 18,
  issues: [],
};

describe('HexView keyboard access', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    useHighlightStore.setState({ hovered: null, locked: null });
    act(() => root.render(createElement(HexView, { packet })));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const byte = (offset: number) =>
    container.querySelector<HTMLElement>(`[data-byte-offset="${offset}"]`)!;

  const key = (element: HTMLElement, value: string) =>
    act(() => element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true })));

  it('uses one tab stop and moves focus by byte and row', () => {
    const bytes = [...container.querySelectorAll<HTMLElement>('[data-byte-offset]')];
    expect(bytes.filter((element) => element.tabIndex === 0)).toEqual([byte(0)]);

    act(() => byte(0).focus());
    key(byte(0), 'ArrowRight');
    expect(document.activeElement).toBe(byte(1));
    key(byte(1), 'ArrowDown');
    expect(document.activeElement).toBe(byte(17));
    key(byte(17), 'ArrowDown');
    expect(document.activeElement).toBe(byte(19));
    expect(bytes.filter((element) => element.tabIndex === 0)).toEqual([byte(19)]);
  });

  it('drives highlighting, locking, and an informative accessible name', () => {
    act(() => byte(3).focus());
    expect(useHighlightStore.getState().hovered).toEqual({
      layerUid: 'ipv4-1',
      fieldId: 'header',
    });
    expect(byte(3).getAttribute('aria-label')).toBe(
      'Byte offset 3 (0x3), value 0x03, ipv4 header',
    );

    key(byte(3), 'Enter');
    expect(useHighlightStore.getState().locked).toEqual({
      layerUid: 'ipv4-1',
      fieldId: 'header',
    });
    expect(byte(3).getAttribute('aria-pressed')).toBe('true');
    key(byte(3), ' ');
    expect(useHighlightStore.getState().locked).toBeNull();

    act(() => byte(19).focus());
    key(byte(19), 'Enter');
    expect(useHighlightStore.getState().locked).toEqual({
      layerUid: '__payload__',
      fieldId: 'payload',
    });
    expect(byte(19).getAttribute('aria-label')).toBe(
      'Byte offset 19 (0x13), value 0x13, payload',
    );
  });

  it('has no automated WCAG A/AA violations', async () => {
    const results = await axe.run(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
    });
    expect(results.violations).toEqual([]);
  });
});
