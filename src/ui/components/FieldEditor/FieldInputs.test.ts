// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeIpv4Options } from '../../../core/ipv4Options';
import type { FieldDef } from '../../../core/model';
import { decodeTcpOptions } from '../../../core/tcpOptions';
import { useStackStore } from '../../../store/stackStore';
import FlagsInput from './FlagsInput';
import Ipv4OptionsInput from './Ipv4OptionsInput';
import PayloadSection from './PayloadSection';
import TcpOptionsInput from './TcpOptionsInput';
import TextValueInput from './TextValueInput';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('field editor inputs', () => {
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
  const input = (label: string) =>
    [...container.querySelectorAll<HTMLInputElement>('input')].find(
      (element) => element.getAttribute('aria-label') === label,
    )!;
  const type = (element: HTMLInputElement | HTMLTextAreaElement, value: string) =>
    act(() => {
      const prototype =
        element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });

  it('maps flag bit zero to the most-significant bit', () => {
    const onCommit = vi.fn();
    const field: FieldDef = {
      id: 'control',
      name: 'Control flags',
      type: 'flags',
      bitLength: 8,
      flags: [
        { bit: 0, name: 'High' },
        { bit: 7, name: 'Low' },
      ],
    };
    render(createElement(FlagsInput, { field, value: 0, onCommit }));

    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(checkboxes[0]!.labels?.[0]?.textContent).toContain('High');
    act(() => checkboxes[0]!.click());
    expect(onCommit).toHaveBeenCalledWith(0x80);
  });

  it('marks invalid text without committing and commits a valid value', () => {
    const onCommit = vi.fn();
    const field: FieldDef = { id: 'ttl', name: 'TTL', type: 'uint', bitLength: 8 };
    render(createElement(TextValueInput, { field, value: 64, enumTable: undefined, onCommit }));
    const editor = input('TTL');

    type(editor, '999');
    expect(editor.getAttribute('aria-invalid')).toBe('true');
    expect(onCommit).not.toHaveBeenCalled();

    type(editor, '42');
    expect(editor.hasAttribute('aria-invalid')).toBe(false);
    expect(onCommit).toHaveBeenCalledWith(42);
  });

  it('adopts an external text value change without clobbering a matching draft', () => {
    const onCommit = vi.fn();
    const field: FieldDef = { id: 'port', name: 'Port', type: 'uint', bitLength: 16 };
    render(createElement(TextValueInput, { field, value: 80, enumTable: undefined, onCommit }));
    const editor = input('Port');

    type(editor, '10000');
    render(createElement(TextValueInput, { field, value: 10_000, enumTable: undefined, onCommit }));
    expect(editor.value).toBe('10000');

    render(createElement(TextValueInput, { field, value: 443, enumTable: undefined, onCommit }));
    expect(editor.value).toBe('443');
  });

  it('round-trips toggled TCP options through committed bytes', () => {
    const onCommit = vi.fn();
    render(
      createElement(TcpOptionsInput, {
        value: new Uint8Array(),
        onCommit,
        rawFallback: createElement('span', null, 'raw TCP'),
      }),
    );
    expect(container.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('TCP options');

    act(() => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    const committed = onCommit.mock.calls[0]![0] as Uint8Array;
    expect(decodeTcpOptions(committed)).toEqual({ mss: 0 });
  });

  it('uses the raw fallback for an undecodable TCP option', () => {
    render(
      createElement(TcpOptionsInput, {
        value: new Uint8Array([2, 3, 0]),
        onCommit: vi.fn(),
        rawFallback: createElement('span', null, 'raw TCP'),
      }),
    );
    expect(container.textContent).toBe('raw TCP');
  });

  it('round-trips toggled IPv4 options through committed bytes', () => {
    const onCommit = vi.fn();
    render(
      createElement(Ipv4OptionsInput, {
        value: new Uint8Array(),
        onCommit,
        rawFallback: createElement('span', null, 'raw IPv4'),
      }),
    );
    expect(container.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('IPv4 options');

    act(() => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    const committed = onCommit.mock.calls[0]![0] as Uint8Array;
    expect(decodeIpv4Options(committed)).toEqual({ routerAlert: 0 });
  });

  it('uses the raw fallback for an undecodable IPv4 option', () => {
    render(
      createElement(Ipv4OptionsInput, {
        value: new Uint8Array([148, 3, 0]),
        onCommit: vi.fn(),
        rawFallback: createElement('span', null, 'raw IPv4'),
      }),
    );
    expect(container.textContent).toBe('raw IPv4');
  });

  it('switches payload modes, validates hex, and resyncs external changes', () => {
    useStackStore.setState({ trailingPayload: new TextEncoder().encode('hi') });
    render(createElement(PayloadSection));
    const hexButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'hex',
    )!;
    act(() => hexButton.click());
    const editor = container.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(editor.getAttribute('aria-label')).toBe('Payload (hex)');
    expect(editor.value).toBe('68 69');

    type(editor, 'zz');
    expect(editor.getAttribute('aria-invalid')).toBe('true');
    expect(useStackStore.getState().trailingPayload).toEqual(new TextEncoder().encode('hi'));

    act(() => useStackStore.getState().setPayload(new Uint8Array([0xde, 0xad])));
    expect(editor.value).toBe('de ad');
    expect(editor.hasAttribute('aria-invalid')).toBe(false);
  });
});
