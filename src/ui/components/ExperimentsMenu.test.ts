// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newLayer, type StackInstance } from '../../core/model';
import { serializeStack } from '../../core/serialize';
import { createBuiltinRegistry } from '../../protocols';
import { useStackStore } from '../../store/stackStore';
import ExperimentsMenu from './ExperimentsMenu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const registry = createBuiltinRegistry();

describe('ExperimentsMenu', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    useStackStore.setState({
      layers: [newLayer('ethernet'), newLayer('ipv4'), newLayer('tcp')],
      trailingPayload: new Uint8Array(),
    });
    useStackStore.getState().clearHistory();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (element: ReactElement) => act(() => root.render(element));
  const buttonWithText = (text: string) =>
    [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;

  const mount = (onApply = vi.fn()) => {
    const { layers, trailingPayload } = useStackStore.getState();
    const stack: StackInstance = { layers, trailingPayload };
    const packet = serializeStack(stack, registry);
    render(createElement(ExperimentsMenu, { stack, registry, packet, onApply }));
    return { stack, onApply };
  };

  it('lists only applicable experiments, applies one, and it is undoable', () => {
    const { onApply } = mount();

    // Open the menu.
    act(() => buttonWithText('Break').click());
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
    // TCP stack → no UDP experiment offered.
    expect(container.textContent).toContain('Corrupt the IPv4 header checksum');
    expect(container.textContent).not.toContain('UDP');

    // Apply the IPv4 checksum experiment.
    act(() => buttonWithText('Corrupt the IPv4 header checksum').click());

    expect(onApply).toHaveBeenCalledTimes(1);
    const application = onApply.mock.calls[0]![0];
    expect(application.fieldId).toBe('headerChecksum');

    // The store pinned exactly that field to the wrong value…
    const ipv4 = useStackStore.getState().layers[1]!;
    expect(ipv4.pinned).toContain('headerChecksum');
    expect(ipv4.overrides.headerChecksum).toBe(application.value);

    // …which the serializer now flags.
    const after = serializeStack(
      { layers: useStackStore.getState().layers, trailingPayload: new Uint8Array() },
      registry,
    );
    expect(after.issues.some((i) => /checksum/i.test(i.message))).toBe(true);

    // Undo restores the previous packet exactly (no pin, no override).
    act(() => useStackStore.getState().undo());
    const restored = useStackStore.getState().layers[1]!;
    expect(restored.pinned).not.toContain('headerChecksum');
    expect('headerChecksum' in restored.overrides).toBe(false);
  });

  it('disables the trigger when no experiment applies', () => {
    useStackStore.setState({ layers: [newLayer('ethernet')], trailingPayload: new Uint8Array() });
    mount();
    expect(buttonWithText('Break').disabled).toBe(true);
  });
});
