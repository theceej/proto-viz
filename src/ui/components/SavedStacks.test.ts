// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBuiltinRegistry } from '../../protocols';

const { loadSavedStacks } = vi.hoisted(() => ({ loadSavedStacks: vi.fn() }));
vi.mock('../../store/persistence', () => ({
  loadSavedStacks,
  saveStack: vi.fn(),
  deleteSavedStack: vi.fn(),
}));

import SavedStacks from './SavedStacks';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SavedStacks persistence states', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    loadSavedStacks.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = () => act(() => root.render(createElement(SavedStacks, {
    stack: { layers: [], trailingPayload: new Uint8Array() },
    registry: createBuiltinRegistry(),
  })));

  const click = (text: string) => act(() => {
    [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text))!.click();
  });

  it('shows a genuine empty state only after a successful read', async () => {
    loadSavedStacks.mockResolvedValue({ ok: true, data: [] });
    render();
    click('Saved');
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain('No saved stacks yet');
  });

  it('warns without claiming data is empty and retries a failed read', async () => {
    loadSavedStacks
      .mockResolvedValueOnce({ ok: false, errorName: 'InvalidStateError' })
      .mockResolvedValueOnce({ ok: true, data: [] });
    render();
    click('Saved');
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain('Existing data has not been changed');
    expect(container.textContent).not.toContain('No saved stacks yet');

    click('Retry');
    await act(async () => { await Promise.resolve(); });
    expect(loadSavedStacks).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('No saved stacks yet');
  });
});
