import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildCapture } from '../core/capture';
import { readPcap } from '../core/pcapRead';
import { EMPTY_FILTER } from '../core/captureFilter';
import { createBuiltinRegistry } from '../protocols';
import { useCaptureStore } from './captureStore';

const registry = createBuiltinRegistry();
const sample = () =>
  buildCapture(
    readPcap(new Uint8Array(readFileSync('fixtures/capture-handshake.pcap'))),
    registry,
    'capture-handshake.pcap',
  );

describe('captureStore', () => {
  beforeEach(() => useCaptureStore.getState().close());

  it('selects the first packet when a capture is opened', () => {
    useCaptureStore.getState().setCapture(sample());

    const state = useCaptureStore.getState();
    expect(state.capture?.packets).toHaveLength(5);
    expect(state.selected).toBe(1);
  });

  it('resets the filter and flow selection for a new capture', () => {
    const store = useCaptureStore.getState();
    store.setCapture(sample());
    store.setFilter({ ...EMPTY_FILTER, text: 'dns' });
    store.setFlowKey('tcp|192.0.2.10:49152|198.51.100.20:80');

    useCaptureStore.getState().setCapture(sample());

    expect(useCaptureStore.getState().filter).toEqual(EMPTY_FILTER);
    expect(useCaptureStore.getState().flowKey).toBeNull();
  });

  it('keeps the selection while the capture stays open', () => {
    useCaptureStore.getState().setCapture(sample());
    useCaptureStore.getState().select(4);

    expect(useCaptureStore.getState().selected).toBe(4);
    expect(useCaptureStore.getState().capture).not.toBeNull();
  });

  it('drops everything when the capture is closed', () => {
    useCaptureStore.getState().setCapture(sample());
    useCaptureStore.getState().close();

    const state = useCaptureStore.getState();
    expect(state.capture).toBeNull();
    expect(state.selected).toBeNull();
    expect(state.flowKey).toBeNull();
  });
});
