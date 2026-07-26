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
import HexView, { virtualRowRange } from './HexView';
import { asciiByte, spanByteRange } from './FieldInspector';
import ResizablePanes from './ResizablePanes';

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

describe('virtualRowRange', () => {
  it('bounds and overscans the visible fixed-height rows', () => {
    expect(virtualRowRange(10_000, 20_000, 200, 20, 6)).toEqual({
      start: 994,
      end: 1016,
    });
    expect(virtualRowRange(10, 10_000, 200, 20, 6)).toEqual({ start: 9, end: 10 });
    expect(virtualRowRange(0, 0, 200)).toEqual({ start: 0, end: 0 });
  });
});

describe('HexView keyboard access', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.removeItem('pv-hex-column');
    localStorage.removeItem('pv-hex-ascii');
    localStorage.removeItem('pv-hex-edit');
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

  it('mounts a bounded window for a large packet and updates it at the middle and end', () => {
    const largePacket = { ...packet, bytes: new Uint8Array(65_535), spans: [], layers: [] };
    act(() => root.render(createElement(HexView, { packet: largePacket, registry })));
    const scroller = container.querySelector<HTMLElement>('[aria-label*="total bytes"]')!;
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 200 });
    Object.defineProperty(scroller, 'scrollTo', {
      configurable: true,
      value: ({ top }: ScrollToOptions) => {
        scroller.scrollTop = top ?? 0;
      },
    });

    const mountedOffsets = () =>
      [...container.querySelectorAll<HTMLElement>('[data-byte-offset]')].map((cell) =>
        Number(cell.dataset.byteOffset),
      );
    expect(mountedOffsets().length).toBeLessThanOrEqual(512);
    expect(scroller.getAttribute('aria-label')).toBe('Packet hex dump, 65535 total bytes');

    act(() => {
      scroller.scrollTop = 2_000 * 20;
      scroller.dispatchEvent(new Event('scroll'));
    });
    const middle = mountedOffsets();
    expect(middle.length).toBeLessThanOrEqual(512);
    expect(middle[0]).toBeGreaterThan(30_000);
    expect(middle.at(-1)).toBeLessThan(33_000);
    expect(container.querySelector('[data-visible-byte-range]')?.textContent).toContain(
      'Visible window bytes 31904 through 32255 of 65535 total bytes.',
    );

    act(() => {
      scroller.scrollTop = Math.ceil(largePacket.bytes.length / 16) * 20 - 200;
      scroller.dispatchEvent(new Event('scroll'));
    });
    const end = mountedOffsets();
    expect(end.length).toBeLessThanOrEqual(512);
    expect(end.at(-1)).toBe(65_534);
  });

  it('renders and focuses an arrow-key destination beyond the virtual window', () => {
    const largePacket = { ...packet, bytes: new Uint8Array(65_535), spans: [], layers: [] };
    act(() => root.render(createElement(HexView, { packet: largePacket, registry })));
    const scroller = container.querySelector<HTMLElement>('[aria-label*="total bytes"]')!;
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 200 });
    Object.defineProperty(scroller, 'scrollTo', {
      configurable: true,
      value: ({ top }: ScrollToOptions) => {
        scroller.scrollTop = top ?? 0;
      },
    });
    act(() => scroller.dispatchEvent(new Event('scroll')));
    const mounted = [...container.querySelectorAll<HTMLElement>('[data-byte-offset]')];
    const boundary = mounted.at(-1)!;
    const destination = Number(boundary.dataset.byteOffset) + 1;

    act(() => boundary.focus());
    key(boundary, 'ArrowRight');

    expect(document.activeElement).toBe(byte(destination));
    expect(container.querySelectorAll('[data-byte-offset]').length).toBeLessThanOrEqual(528);
  });

  it('keeps a focused row mounted when scrolling it outside the visible window', () => {
    const largePacket = { ...packet, bytes: new Uint8Array(65_535), spans: [], layers: [] };
    act(() => root.render(createElement(HexView, { packet: largePacket, registry })));
    const scroller = container.querySelector<HTMLElement>('[aria-label*="total bytes"]')!;
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 200 });
    act(() => byte(2).focus());
    act(() => {
      scroller.scrollTop = 2_000 * 20;
      scroller.dispatchEvent(new Event('scroll'));
    });

    expect(byte(2)).toBe(document.activeElement);
    expect(container.querySelectorAll('[data-byte-offset]').length).toBeLessThanOrEqual(528);
  });

  it('uses the desktop pane as its only scroll owner', () => {
    act(() =>
      root.render(
        createElement(ResizablePanes, {
          storagePrefix: 'hex-virtualization-test',
          left: { title: 'Left', children: 'left' },
          center: { title: 'Center', children: 'center' },
          right: {
            title: 'Hex dump',
            scrollFocusable: true,
            children: createElement(HexView, { packet, registry }),
          },
        }),
      ),
    );
    const hex = container.querySelector<HTMLElement>('[aria-label*="total bytes"]')!;
    expect(hex.className).not.toContain('overflow-auto');
    expect(hex.parentElement?.className).toContain('overflow-auto');
  });

  it('uses eight bytes per row on mobile', () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        matches: true,
        media: '(max-width: 767px)',
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => true,
      }),
    });
    try {
      act(() =>
        root.render(
          createElement(ResizablePanes, {
            storagePrefix: 'hex-mobile-virtualization-test',
            left: { title: 'Left', children: 'left' },
            center: {
              title: 'Hex dump',
              children: createElement(HexView, { key: 'mobile', packet, registry }),
            },
            right: { title: 'Right', children: 'right' },
          }),
        ),
      );
      const hex = container.querySelector<HTMLElement>('[aria-label*="total bytes"]')!;
      expect(hex.className).not.toContain('overflow-auto');
      expect(hex.parentElement?.getAttribute('role')).toBe('tabpanel');
      expect(hex.parentElement?.className).toContain('overflow-auto');
      expect(container.querySelector('[aria-label="Hex bytes 0 through 7"]')).not.toBeNull();
      expect(container.querySelector('[aria-label="Hex bytes 8 through 15"]')).not.toBeNull();
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: originalMatchMedia,
      });
    }
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

  it('independently toggles and persists the hex column', () => {
    const toggle = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Hex',
    )!;
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-byte-offset]')).not.toBeNull();

    act(() => toggle.click());
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[data-byte-offset]')).toBeNull();
    expect(container.querySelector('[data-ascii-offset]')).not.toBeNull();
    expect(localStorage.getItem('pv-hex-column')).toBe('false');
  });

  it('shows details, raw bytes, state, and a specification link for a locked field', async () => {
    // The inspector fetches the reference tables on demand (they are kept out
    // of the eager graph). Warming the module cache first means the import
    // inside the component resolves in a single microtask, which one async
    // act() then flushes deterministically.
    await import('../../protocols/refs');
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
          calculation: {
            kind: 'expression',
            result: 12,
            pinnedValue: 0xbc,
            steps: [
              { label: 'Header length', value: '8 bytes' },
              { label: 'Arithmetic', value: '8 + 4 = 12' },
            ],
          },
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
    // Async act so the inspector's on-demand reference fetch settles inside
    // the act scope rather than warning about an update outside it.
    await act(async () => {
      container.querySelector<HTMLElement>('[data-byte-offset="0"]')!.click();
    });

    const inspector = container.querySelector<HTMLElement>('[aria-label="Selected field"]')!;
    expect(inspector.textContent).toContain('Example · Kind');
    expect(inspector.textContent).toContain('bytes 0–1 · bits 4–11');
    expect(inspector.textContent).toContain('ab cd');
    expect(inspector.textContent).toContain('computed');
    expect(inspector.textContent).toContain('pinned');
    expect(inspector.textContent).toContain('1 layer issue');
    expect(inspector.textContent).toContain('Example validation warning.');
    expect(inspector.textContent).toContain('Calculation trace');
    expect(inspector.textContent).toContain('Pinned wire value188 (0xbc)');
    expect(inspector.textContent).toContain('Calculated value12 (0xc)');
    expect(inspector.textContent).toContain('8 + 4 = 12');
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

  it('shows no Edit toggle and does not edit when editing is not wired', () => {
    expect([...container.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Edit')).toBe(
      false,
    );
    act(() => byte(3).focus());
    key(byte(3), '4');
    expect(byte(3).textContent?.trim()).toBe('03'); // unchanged — no editor
    expect(byte(3).className).toContain('cursor-pointer');
  });

  it('has no automated WCAG A/AA violations', async () => {
    const results = await axe.run(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
    });
    expect(results.violations).toEqual([]);
  });
});

describe('HexView byte editing', () => {
  let container: HTMLDivElement;
  let root: Root;
  let onByteEdit: ReturnType<typeof vi.fn<(byteOffset: number, value: number) => void>>;

  const editToggle = () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Edit')!;

  beforeEach(() => {
    localStorage.removeItem('pv-hex-edit');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    onByteEdit = vi.fn<(byteOffset: number, value: number) => void>();
    useHighlightStore.setState({ hovered: null, locked: null });
    act(() => root.render(createElement(HexView, { packet, registry, onByteEdit })));
    // These tests exercise editing, so start in Edit mode.
    act(() => editToggle().click());
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.removeItem('pv-hex-edit');
  });

  const byte = (offset: number) =>
    container.querySelector<HTMLElement>(`[data-byte-offset="${offset}"]`)!;
  const key = (element: HTMLElement, value: string) =>
    act(() => element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true })));

  it('only edits once Edit mode is enabled, and shows an I-beam cursor', () => {
    // Turn Edit mode back off: typing should no longer edit, and click locks.
    act(() => editToggle().click());
    expect(editToggle().getAttribute('aria-pressed')).toBe('false');
    expect(byte(3).className).toContain('cursor-pointer');
    act(() => byte(3).focus());
    key(byte(3), '4');
    key(byte(3), 'e');
    expect(onByteEdit).not.toHaveBeenCalled();
    act(() => byte(3).click());
    expect(useHighlightStore.getState().locked?.fieldId).toBe('header');

    // Re-enable: the cursor signals editability and a click no longer locks.
    act(() => {
      useHighlightStore.setState({ locked: null });
    });
    act(() => editToggle().click());
    expect(byte(3).className).toContain('cursor-text');
    act(() => byte(3).click());
    expect(useHighlightStore.getState().locked).toBeNull();
  });

  it('commits a byte after two hex digits and shows the pending nibble', () => {
    act(() => byte(3).focus());
    key(byte(3), '4');
    expect(onByteEdit).not.toHaveBeenCalled();
    expect(byte(3).textContent?.trim()).toBe('4');
    key(byte(3), 'e');
    expect(onByteEdit).toHaveBeenCalledWith(3, 0x4e);
  });

  it('advertises editability in the accessible name', () => {
    expect(byte(3).getAttribute('aria-label')).toContain('Type two hex digits to edit');
    act(() => byte(3).focus());
    key(byte(3), '4');
    expect(byte(3).getAttribute('aria-label')).toContain('Editing byte offset 3');
  });

  it('cancels a pending edit on Escape and commits a single nibble on Enter', () => {
    act(() => byte(5).focus());
    key(byte(5), 'a');
    key(byte(5), 'Escape');
    expect(onByteEdit).not.toHaveBeenCalled();
    expect(byte(5).textContent?.trim()).toBe('05');

    key(byte(5), 'a');
    key(byte(5), 'Enter');
    expect(onByteEdit).toHaveBeenCalledWith(5, 0x0a);
  });

  it('rejects delete/backspace and non-hex keys without corrupting the buffer', () => {
    act(() => byte(2).focus());
    key(byte(2), '3');
    key(byte(2), 'z'); // non-hex: ignored, pending nibble preserved
    expect(byte(2).textContent?.trim()).toBe('3');
    expect(onByteEdit).not.toHaveBeenCalled();
    key(byte(2), 'Backspace'); // length-changing: rejected, edit cleared
    expect(onByteEdit).not.toHaveBeenCalled();
    expect(byte(2).textContent?.trim()).toBe('02');
  });

  it('abandons a pending edit when arrows move focus', () => {
    act(() => byte(4).focus());
    key(byte(4), 'c');
    expect(byte(4).textContent?.trim()).toBe('c');
    key(byte(4), 'ArrowRight');
    expect(document.activeElement).toBe(byte(5));
    expect(byte(4).textContent?.trim()).toBe('04');
    expect(onByteEdit).not.toHaveBeenCalled();
  });

  it('reserves Enter for edits in Edit mode (no lock toggle)', () => {
    act(() => byte(3).focus());
    key(byte(3), 'Enter');
    expect(useHighlightStore.getState().locked).toBeNull();
  });

  it('has no automated WCAG A/AA violations while editable', async () => {
    const results = await axe.run(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
    });
    expect(results.violations).toEqual([]);
  });
});
