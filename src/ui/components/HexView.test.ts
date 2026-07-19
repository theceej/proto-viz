// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SerializedPacket } from '../../core/serialize';
import { createBuiltinRegistry } from '../../protocols';
import { createRegistry } from '../../core/registry';
import type { ProtocolDefinition } from '../../core/model';
import { useHighlightStore } from '../../store/highlightStore';
import HexView from './HexView';
import { asciiByte, spanByteRange } from './FieldInspector';

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
const registry = createBuiltinRegistry();

describe('HexView keyboard access', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.removeItem('pv-hex-ascii');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    useHighlightStore.setState({ hovered: null, locked: null });
    act(() => root.render(createElement(HexView, { packet, registry })));
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

  it('supports pointer highlighting and locking', () => {
    act(() => byte(2).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(useHighlightStore.getState().hovered?.fieldId).toBe('header');
    act(() => byte(2).click());
    expect(useHighlightStore.getState().locked?.fieldId).toBe('header');
    act(() => byte(2).dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
    expect(useHighlightStore.getState().hovered).toBeNull();
  });

  it('copies the complete packet hex', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Copy the packet as a hex string"]')!
        .click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(
      '000102030405060708090a0b0c0d0e0f10111213',
    );
    expect(container.querySelector('button[aria-label="Packet hex copied"]')).not.toBeNull();
  });

  it('renders an explicit empty state', () => {
    act(() =>
      root.render(
        createElement(HexView, { packet: { ...packet, bytes: new Uint8Array() }, registry }),
      ),
    );
    expect(container.textContent).toContain('empty packet');
  });

  it('makes the ASCII column keyboard-operable and optional', () => {
    const ascii = (offset: number) =>
      container.querySelector<HTMLElement>(`[data-ascii-offset="${offset}"]`)!;
    expect(ascii(0).getAttribute('aria-label')).toContain('ASCII .');
    expect(ascii(0).tabIndex).toBe(0);

    act(() => ascii(2).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(useHighlightStore.getState().hovered?.fieldId).toBe('header');
    act(() => ascii(2).dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
    expect(useHighlightStore.getState().hovered).toBeNull();
    act(() => ascii(2).click());
    expect(useHighlightStore.getState().locked?.fieldId).toBe('header');
    act(() => ascii(2).click());
    expect(useHighlightStore.getState().locked).toBeNull();

    act(() => ascii(0).focus());
    key(ascii(0), 'ArrowRight');
    expect(document.activeElement).toBe(ascii(1));
    key(ascii(1), 'Enter');
    expect(useHighlightStore.getState().locked?.fieldId).toBe('header');

    const toggle = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'ASCII',
    )!;
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    act(() => toggle.click());
    expect(container.querySelector('[data-ascii-offset]')).toBeNull();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows details, raw bytes, state, and a specification link for a locked field', () => {
    const def: ProtocolDefinition = {
      id: 'example',
      name: 'Example',
      layerHint: 'network',
      source: 'custom',
      references: ['RFC 791'],
      fields: [
        {
          id: 'kind',
          name: 'Kind',
          type: 'uint',
          bitLength: 8,
          description: 'Identifies the example packet kind.',
        },
      ],
      providesNamespaces: [],
      encapsulations: [],
    };
    const selectedPacket: SerializedPacket = {
      bytes: new Uint8Array([0xab, 0xcd]),
      spans: [
        {
          layerUid: 'example-1',
          fieldId: 'kind',
          bitOffset: 4,
          bitLength: 8,
          value: 0xbc,
          computed: true,
          pinned: true,
        },
      ],
      layers: [{ uid: 'example-1', protocolId: 'example', byteOffset: 0, headerBytes: 2 }],
      payloadOffset: 2,
      issues: [],
    };
    act(() =>
      root.render(
        createElement(HexView, {
          packet: selectedPacket,
          registry: createRegistry([def]),
          validation: [
            {
              severity: 'warning',
              layerIndex: 0,
              code: 'example-warning',
              message: 'Example validation warning.',
            },
          ],
          inspectionMode: 'deep',
        }),
      ),
    );
    act(() => container.querySelector<HTMLElement>('[data-byte-offset="0"]')!.click());

    const inspector = container.querySelector<HTMLElement>('[aria-label="Selected field"]')!;
    expect(inspector.textContent).toContain('Example · Kind');
    expect(inspector.textContent).toContain('bytes 0–1 · bits 4–11');
    expect(inspector.textContent).toContain('ab cd');
    expect(inspector.textContent).toContain('computed');
    expect(inspector.textContent).toContain('pinned');
    expect(inspector.textContent).toContain('1 layer issue');
    expect(inspector.textContent).toContain('Example validation warning.');
    expect(inspector.textContent).toContain('Identifies the example packet kind.');
    expect(inspector.querySelector('a')?.getAttribute('href')).toContain('/rfc791');

    act(() =>
      root.render(
        createElement(HexView, {
          packet: selectedPacket,
          registry: createRegistry([def]),
          inspectionMode: 'compact',
        }),
      ),
    );
    const compactInspector = container.querySelector<HTMLElement>(
      '[aria-label="Selected field"]',
    )!;
    expect(compactInspector.textContent).not.toContain('Range');
    expect(compactInspector.textContent).not.toContain('Identifies the example packet kind.');
  });

  it('switches inspection detail without changing packet bytes', () => {
    const before = [...packet.bytes];
    const onChange = vi.fn();
    act(() =>
      root.render(
        createElement(HexView, {
          packet,
          registry,
          inspectionMode: 'compact',
          onInspectionModeChange: onChange,
        }),
      ),
    );
    const deep = container.querySelector<HTMLButtonElement>(
      '[role="radio"][title*="Wire ranges"]',
    )!;
    act(() => deep.click());
    expect(onChange).toHaveBeenCalledWith('deep');
    expect([...packet.bytes]).toEqual(before);
  });

  it('formats ASCII and bit-spanning byte ranges', () => {
    expect(asciiByte(0x41)).toBe('A');
    expect(asciiByte(0x1f)).toBe('.');
    expect(asciiByte(0x7f)).toBe('.');
    expect(spanByteRange({ bitOffset: 4, bitLength: 8 })).toEqual({ start: 0, end: 1 });
  });

  it('has no automated WCAG A/AA violations', async () => {
    const results = await axe.run(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
    });
    expect(results.violations).toEqual([]);
  });
});
