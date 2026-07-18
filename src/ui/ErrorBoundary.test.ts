// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ErrorBoundary from './ErrorBoundary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ErrorBoundary', () => {
  let container: HTMLDivElement;
  let root: Root;
  let shouldThrow: boolean;

  function Broken() {
    if (shouldThrow) throw new Error('private packet contents: deadbeef');
    return createElement('p', null, 'Recovered application');
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    shouldThrow = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    window.location.hash = '#/builder?s=private-share-code';
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  const button = (name: string) =>
    [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(name))!;

  it('shows a usable fallback and retries the subtree', () => {
    act(() => root.render(createElement(ErrorBoundary, null, createElement(Broken))));
    expect(container.textContent).toContain('unexpected error');

    shouldThrow = false;
    act(() => button('Try again').click());
    expect(container.textContent).toContain('Recovered application');
  });

  it('copies privacy-conscious diagnostics without error messages or query data', async () => {
    const copyText = vi.fn().mockResolvedValue(undefined);
    act(() =>
      root.render(
        createElement(ErrorBoundary, { copyText, children: createElement(Broken) }),
      ),
    );

    await act(async () => {
      button('Copy diagnostics').click();
      await Promise.resolve();
    });

    const report = copyText.mock.calls[0]![0] as string;
    expect(report).toContain('Route: #/builder');
    expect(report).toContain('Error type: Error');
    expect(report).not.toContain('deadbeef');
    expect(report).not.toContain('private-share-code');
    expect(button('Diagnostics copied')).toBeTruthy();
  });

  it('reloads directly or after clearing only known UI preferences', () => {
    const reload = vi.fn();
    localStorage.setItem('pv-theme', 'light');
    localStorage.setItem('pv-pane-fields', 'true');
    localStorage.setItem('unrelated', 'keep');
    act(() =>
      root.render(createElement(ErrorBoundary, { reload, children: createElement(Broken) })),
    );

    act(() => button('Reload').click());
    expect(reload).toHaveBeenCalledTimes(1);
    act(() => button('Reset UI preferences').click());
    expect(reload).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('pv-theme')).toBeNull();
    expect(localStorage.getItem('pv-pane-fields')).toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });
});
