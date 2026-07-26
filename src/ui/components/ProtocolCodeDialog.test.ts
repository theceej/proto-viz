// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBuiltinRegistry } from '../../protocols';
import ProtocolCodeDialog from './ProtocolCodeDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ProtocolCodeDialog', () => {
  let container: HTMLDivElement;
  let root: Root;
  const clipboard = { writeText: vi.fn<(text: string) => Promise<void>>() };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    clipboard.writeText.mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const mount = (onClose = vi.fn()) => {
    const definition = createBuiltinRegistry().get('ipv4')!;
    act(() => root.render(createElement(ProtocolCodeDialog, { definition, onClose })));
    return onClose;
  };

  it('switches targets and copies the generated source', async () => {
    mount();
    const select = container.querySelector('select')!;
    expect(container.textContent).toContain('ipv4.h');
    expect(container.querySelector('[aria-label="Generated protocol code"]')?.textContent).toContain(
      '#pragma once',
    );

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'go');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.textContent).toContain('ipv4.go');
    expect(container.querySelector('[aria-label="Generated protocol code"]')?.textContent).toContain(
      'package ipv4',
    );

    const copy = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Copy code'))!;
    await act(async () => copy.click());
    expect(clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('package ipv4'));
    expect(container.textContent).toContain('Code copied');
  });

  it('downloads with the generated filename and reports clipboard errors', async () => {
    mount();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:generated');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const download = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Download'))!;
    act(() => download.click());
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:generated');

    clipboard.writeText.mockRejectedValueOnce(new Error('denied'));
    const copy = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Copy code'))!;
    await act(async () => copy.click());
    expect(container.textContent).toContain('Clipboard copy failed: denied');
  });

  it('closes on Escape', () => {
    const onClose = mount();
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
