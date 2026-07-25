// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommandStore, type Command } from '../../store/commandStore';
import CommandPalette from './CommandPalette';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const run = { library: vi.fn(), decode: vi.fn(), share: vi.fn() };

const commands: Command[] = [
  { id: 'nav:lib', title: 'Go to Protocol Library', group: 'Navigation', keywords: ['library'], run: run.library },
  { id: 'b.decode', title: 'Decode packet from hex', group: 'Builder', keywords: ['paste'], run: run.decode },
  { id: 'b.share', title: 'Share stack', group: 'Builder', keywords: ['link'], run: run.share },
];

describe('CommandPalette', () => {
  let container: HTMLDivElement;
  let root: Root;

  const key = (target: EventTarget, value: string, mods: Partial<KeyboardEvent> = {}) =>
    act(() =>
      target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, ...mods })),
    );
  const input = () => container.querySelector<HTMLInputElement>('input[role="combobox"]');
  const options = () => [...container.querySelectorAll<HTMLElement>('[role="option"]')];
  const type = (box: HTMLInputElement, value: string) => {
    // Bypass React's value tracker so onChange fires for the new value.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, value);
    act(() => box.dispatchEvent(new Event('input', { bubbles: true })));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useCommandStore.setState({ open: false, owners: { test: commands } });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(createElement(CommandPalette)));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useCommandStore.setState({ open: false, owners: {} });
  });

  it('is closed until the store opens it, then shows every command', () => {
    expect(input()).toBeNull();
    key(window, 'k', { ctrlKey: true });
    expect(input()).not.toBeNull();
    expect(options().map((o) => o.textContent)).toEqual([
      'Go to Protocol Library',
      'Decode packet from hex',
      'Share stack',
    ]);
  });

  it('filters as you type and runs the highlighted command on Enter', () => {
    act(() => useCommandStore.getState().setOpen(true));
    const box = input()!;
    type(box, 'share');
    expect(options().map((o) => o.textContent)).toEqual(['Share stack']);
    key(box, 'Enter');
    expect(run.share).toHaveBeenCalledTimes(1);
    // Running a command closes the palette.
    expect(useCommandStore.getState().open).toBe(false);
  });

  it('moves the selection with arrow keys and runs on Enter', () => {
    act(() => useCommandStore.getState().setOpen(true));
    const box = input()!;
    key(box, 'ArrowDown'); // 2nd item (Decode)
    key(box, 'Enter');
    expect(run.decode).toHaveBeenCalledTimes(1);
    expect(run.library).not.toHaveBeenCalled();
  });

  it('closes on Escape without running anything', () => {
    act(() => useCommandStore.getState().setOpen(true));
    key(window, 'Escape');
    expect(useCommandStore.getState().open).toBe(false);
    expect(run.library).not.toHaveBeenCalled();
  });

  it('has no automated WCAG A/AA violations while open', async () => {
    act(() => useCommandStore.getState().setOpen(true));
    const results = await axe.run(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
    });
    expect(results.violations).toEqual([]);
  });
});
