// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PwaStatus from './PwaStatus';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, vi.fn()],
    updateServiceWorker: vi.fn(),
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('PwaStatus', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    sessionStorage.clear();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response()));
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const mount = () => act(() => root.render(createElement(PwaStatus)));

  it('shows and clears offline status as connectivity changes', async () => {
    mount();
    expect(container.textContent).toBe('');

    act(() => window.dispatchEvent(new Event('offline')));
    expect(container.textContent).toContain('Offline');

    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
    });
    expect(container.textContent).toBe('');
  });

  it('retains an offline event across a cached document reload', () => {
    mount();
    act(() => window.dispatchEvent(new Event('offline')));
    act(() => root.unmount());

    // Chromium can report true here when a service worker fulfilled the reload.
    expect(navigator.onLine).toBe(true);
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));
    root = createRoot(container);
    mount();
    expect(container.textContent).toContain(
      'Offline — the builder and protocol library remain available.',
    );
  });

  it('uses navigator status when session storage is empty', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    mount();
    expect(container.textContent).toContain('Offline');
  });

  it('stays offline when a service-worker reload emits online without origin access', async () => {
    sessionStorage.setItem('pv-network-offline', '1');
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));
    mount();
    act(() => window.dispatchEvent(new Event('online')));
    await act(async () => Promise.resolve());
    expect(container.textContent).toContain('Offline');
  });
});
