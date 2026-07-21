// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newLayer, type FieldDef, type LayerInstance } from '../../../core/model';
import { serializeStack } from '../../../core/serialize';
import { createBuiltinRegistry } from '../../../protocols';
import { isActive, useHighlightStore } from '../../../store/highlightStore';
import { useStackStore } from '../../../store/stackStore';
import FieldEditor from './index';
import FieldInput from './FieldInput';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const registry = createBuiltinRegistry();

describe('FieldEditor tree', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    useHighlightStore.setState({ hovered: null, locked: null });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (element: ReactElement) => act(() => root.render(element));
  const byLabel = (label: string) =>
    [...container.querySelectorAll<HTMLElement>('button, input')].find(
      (el) => el.getAttribute('aria-label') === label,
    )!;
  const type = (element: HTMLInputElement, value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });

  /** Seed the stack store with `layers`, serialize them, and render the editor. */
  const mount = (layers: LayerInstance[]) => {
    useStackStore.setState({ layers, trailingPayload: new Uint8Array() });
    const packet = serializeStack({ layers, trailingPayload: new Uint8Array() }, registry);
    render(createElement(MemoryRouter, null, createElement(FieldEditor, { layers, packet, registry })));
    return layers;
  };

  it('renders a section and editable rows for each layer', () => {
    mount([newLayer('ethernet'), newLayer('ipv4')]);
    expect(container.textContent).toContain('Ethernet II');
    expect(container.textContent).toContain('IPv4');
    expect(byLabel('TTL')).toBeDefined();
  });

  it('commits an override when an editable field is edited', () => {
    const layers = mount([newLayer('ethernet'), newLayer('ipv4')]);
    type(byLabel('TTL') as HTMLInputElement, '55');
    expect(useStackStore.getState().layers[1]!.overrides.ttl).toBe(55);
    expect(layers[1]!.protocolId).toBe('ipv4');
  });

  it('toggles field highlight when the field name is clicked', () => {
    const layers = mount([newLayer('ethernet'), newLayer('ipv4')]);
    act(() => byLabel('Highlight TTL in the packet views').click());
    expect(isActive(useHighlightStore.getState().locked, layers[1]!.uid, 'ttl')).toBe(true);
  });

  it('sets and clears the hovered field on pointer enter/leave', () => {
    const layers = mount([newLayer('ethernet'), newLayer('ipv4')]);
    const row = byLabel('Highlight TTL in the packet views').parentElement!;
    act(() => row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(useHighlightStore.getState().hovered).toEqual({ layerUid: layers[1]!.uid, fieldId: 'ttl' });
    act(() => row.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
    expect(useHighlightStore.getState().hovered).toBeNull();
  });

  it('pins a computed field to a manual value', () => {
    const layers = mount([newLayer('ethernet'), newLayer('ipv4')]);
    act(() => byLabel('IHL: pin a manual value').click());
    expect(useStackStore.getState().layers[1]!.pinned).toContain('ihl');
    expect(layers[1]!.pinned).not.toContain('ihl'); // prop layer is untouched
  });

  it('resets an overridden field to its default', () => {
    const ipv4: LayerInstance = { ...newLayer('ipv4'), overrides: { ttl: 55 } };
    mount([newLayer('ethernet'), ipv4]);
    expect(byLabel('Reset TTL to default')).toBeDefined();
    act(() => byLabel('Reset TTL to default').click());
    expect('ttl' in useStackStore.getState().layers[1]!.overrides).toBe(false);
  });

  it('renders the structured IPv4 options editor and commits a change', () => {
    const ipv4: LayerInstance = {
      ...newLayer('ipv4'),
      overrides: { options: new Uint8Array([0x94, 0x04, 0x00, 0x00]) }, // Router Alert
    };
    mount([newLayer('ethernet'), ipv4]);
    const group = [...container.querySelectorAll('[role="group"]')].find(
      (g) => g.getAttribute('aria-label') === 'IPv4 options',
    )!;
    expect(group).toBeDefined();
    act(() => group.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(useStackStore.getState().layers[1]!.overrides.options).toBeInstanceOf(Uint8Array);
  });

  it('renders the structured TCP options editor and commits a change', () => {
    const tcp: LayerInstance = {
      ...newLayer('tcp'),
      overrides: { options: new Uint8Array([2, 4, 0x05, 0xb4]) }, // MSS 1460
    };
    mount([newLayer('ethernet'), newLayer('ipv4'), tcp]);
    const group = [...container.querySelectorAll('[role="group"]')].find(
      (g) => g.getAttribute('aria-label') === 'TCP options',
    )!;
    expect(group).toBeDefined();
    act(() => group.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(useStackStore.getState().layers[2]!.overrides.options).toBeInstanceOf(Uint8Array);
  });

  it('restores a pinned computed field to automatic', () => {
    const ipv4: LayerInstance = { ...newLayer('ipv4'), overrides: { ihl: 5 }, pinned: ['ihl'] };
    mount([newLayer('ethernet'), ipv4]);
    act(() => byLabel('IHL: restore automatic value').click());
    expect(useStackStore.getState().layers[1]!.pinned).not.toContain('ihl');
  });

  it('shows values without inputs or edit controls in read-only mode', () => {
    const ipv4: LayerInstance = { ...newLayer('ipv4'), overrides: { ttl: 55 } };
    const layers = [newLayer('ethernet'), ipv4];
    const packet = serializeStack({ layers, trailingPayload: new Uint8Array() }, registry);
    render(
      createElement(
        MemoryRouter,
        null,
        createElement(FieldEditor, { layers, packet, registry, readOnly: true }),
      ),
    );
    // Values are shown, but no editable input, no pin, and no reset controls.
    expect(container.textContent).toContain('IPv4');
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull(); // read-only payload, not the editor
    expect(byLabel('Reset TTL to default')).toBeUndefined();
    expect(byLabel('IHL: pin a manual value')).toBeUndefined();
    // The highlight toggle stays available for cross-view inspection.
    expect(byLabel('Highlight TTL in the packet views')).toBeDefined();
  });

  it('shows a read-only payload summary when given trailing bytes', () => {
    const layers = [newLayer('ethernet'), newLayer('ipv4'), newLayer('udp')];
    const stack = { layers, trailingPayload: new Uint8Array([0xde, 0xad, 0xbe, 0xef]) };
    const packet = serializeStack(stack, registry);
    render(
      createElement(
        MemoryRouter,
        null,
        createElement(FieldEditor, { layers, packet, registry, readOnly: true }),
      ),
    );
    expect(container.textContent).toContain('Payload');
    expect(container.textContent).toContain('de ad be ef');
  });

  it('renders nothing for a layer whose protocol is unknown, without a packet', () => {
    const bad: LayerInstance = { ...newLayer('ethernet'), protocolId: 'does-not-exist' };
    render(
      createElement(
        MemoryRouter,
        null,
        createElement(FieldEditor, { layers: [newLayer('ethernet'), bad], packet: null, registry }),
      ),
    );
    // The good layer still renders; the unknown one contributes nothing.
    expect(container.textContent).toContain('Ethernet II');
    expect(container.querySelector('textarea')).not.toBeNull(); // payload section present
  });
});

describe('FieldInput dispatcher', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  const render = (element: ReactElement) => act(() => root.render(element));

  it('renders a checkbox group for a flags field', () => {
    const field: FieldDef = {
      id: 'f',
      name: 'Flags',
      type: 'flags',
      bitLength: 8,
      flags: [{ bit: 0, name: 'A' }],
    };
    render(createElement(FieldInput, { field, value: 0, enumTable: undefined, onCommit: vi.fn() }));
    expect(container.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Flags');
    expect(container.querySelector('input[type="checkbox"]')).not.toBeNull();
  });

  it('renders a text input for a non-flags field', () => {
    const field: FieldDef = { id: 'ttl', name: 'TTL', type: 'uint', bitLength: 8 };
    render(createElement(FieldInput, { field, value: 64, enumTable: undefined, onCommit: vi.fn() }));
    const input = container.querySelector<HTMLInputElement>('input');
    expect(input?.getAttribute('aria-label')).toBe('TTL');
    expect(input?.getAttribute('type')).not.toBe('checkbox');
  });
});
