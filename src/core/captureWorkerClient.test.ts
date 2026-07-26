import { describe, expect, it, vi } from 'vitest';
import { createBuiltinRegistry } from '../protocols';
import { parseCaptureAsync } from './captureWorkerClient';
import { openCaptureFile, UnsupportedLinkTypeError, type CapturePacket } from './capture';
import { LINKTYPE, writePcap } from './pcap';
import { newLayer, type StackInstance } from './model';
import { serializeStack } from './serialize';
import type { CaptureProfile } from './captureProfile';

const registry = createBuiltinRegistry();

function makeTestPcap(): Uint8Array {
  const stack: StackInstance = {
    layers: [
      { ...newLayer('ethernet'), overrides: {} },
      { ...newLayer('ipv4'), overrides: { src: '192.0.2.1', dst: '192.0.2.2' } },
      { ...newLayer('udp'), overrides: { srcPort: 5353, dstPort: 5353 } },
    ],
  };
  const pktBytes = serializeStack(stack, registry).bytes;
  return writePcap(
    [
      { bytes: pktBytes, tsSec: 100, tsUsec: 0 },
      { bytes: pktBytes, tsSec: 100, tsUsec: 500 },
    ],
    LINKTYPE.ETHERNET,
  );
}

describe('parseCaptureAsync', () => {
  it('parses capture bytes using parseCaptureAsync (fallback path)', async () => {
    const data = makeTestPcap();
    const onProgress = vi.fn();

    const capture = await parseCaptureAsync({
      data,
      registry,
      fileName: 'sample.pcap',
      onProgress,
    });

    expect(capture.fileName).toBe('sample.pcap');
    expect(capture.packets).toHaveLength(2);
    expect(capture.packets[0]?.topProtocol).toBe('UDP');
    expect(onProgress).toHaveBeenCalled();
  });

  it('requests and reports worker timing only when a profile callback is supplied', async () => {
    const originalWorker = globalThis.Worker;
    const core: CaptureProfile = {
      totalMilliseconds: 10,
      phases: {
        container: { milliseconds: 1, invocations: 1 },
        decode: { milliseconds: 2, invocations: 2 },
        stack: { milliseconds: 1, invocations: 2 },
        serialize: { milliseconds: 2, invocations: 6 },
        checksums: { milliseconds: 1, invocations: 6 },
        identity: { milliseconds: 1, invocations: 2 },
        search: { milliseconds: 1, invocations: 2 },
      },
    };
    let posted: unknown;
    let sentPackets: CapturePacket[] = [];
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage(message: unknown) {
        posted = message;
        const result = openCaptureFile(makeTestPcap(), registry, 'nested.pcap');
        queueMicrotask(() => {
          const { packets, ...capture } = result;
          sentPackets = packets;
          this.onmessage?.({
            data: { type: 'packets', start: 0, packets: packets.slice(0, 1) },
            origin: '',
          } as MessageEvent);
          this.onmessage?.({
            data: { type: 'packets', start: 1, packets: packets.slice(1) },
            origin: '',
          } as MessageEvent);
          this.onmessage?.({
            data: {
              type: 'complete',
              capture,
              packetCount: packets.length,
              profile: {
                workerProcessingMilliseconds: 12,
                processingCompletedAt: performance.timeOrigin + performance.now(),
                core,
              },
            },
            origin: '',
          } as MessageEvent);
        });
      }
      terminate() {}
    }
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker });
    const onProfile = vi.fn();
    try {
      const result = await parseCaptureAsync({
        data: makeTestPcap(),
        registry,
        fileName: 'worker.pcap',
        onProfile,
      });
      expect(result.packets).toHaveLength(2);
      expect(result.packets.map((packet) => packet.number)).toEqual([1, 2]);
      expect(result.packets[0]).toBe(sentPackets[0]);
      expect(result.packets[1]).toBe(sentPackets[1]);
      expect(posted).toMatchObject({ profile: { requestedAt: expect.any(Number) } });
      expect(onProfile).toHaveBeenCalledWith(
        expect.objectContaining({ workerProcessingMilliseconds: 12, core }),
      );
    } finally {
      Object.defineProperty(globalThis, 'Worker', { configurable: true, value: originalWorker });
    }
  });

  it('assembles an empty capture from complete metadata', async () => {
    const originalWorker = globalThis.Worker;
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage() {
        const result = openCaptureFile(
          writePcap([], LINKTYPE.ETHERNET),
          registry,
          'empty.pcap',
        );
        const { packets, ...capture } = result;
        queueMicrotask(() => this.onmessage?.({
          data: { type: 'complete', capture, packetCount: packets.length },
          origin: '',
        } as MessageEvent));
      }
      terminate() {}
    }
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker });
    try {
      const result = await parseCaptureAsync({
        data: writePcap([], LINKTYPE.ETHERNET),
        registry,
        fileName: 'empty.pcap',
      });
      expect(result.packets).toEqual([]);
      expect(result.fileName).toBe('empty.pcap');
    } finally {
      Object.defineProperty(globalThis, 'Worker', { configurable: true, value: originalWorker });
    }
  });

  it('falls back after an out-of-order worker packet batch', async () => {
    const originalWorker = globalThis.Worker;
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage() {
        queueMicrotask(() => this.onmessage?.({
          data: { type: 'packets', start: 1, packets: [] },
          origin: '',
        } as MessageEvent));
      }
      terminate() {}
    }
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker });
    try {
      const result = await parseCaptureAsync({
        data: makeTestPcap(),
        registry,
        fileName: 'bad-order.pcap',
      });
      expect(result.packets).toHaveLength(2);
    } finally {
      Object.defineProperty(globalThis, 'Worker', { configurable: true, value: originalWorker });
    }
  });

  it('keeps worker messages free of profiling metadata by default', async () => {
    const originalWorker = globalThis.Worker;
    let posted: Record<string, unknown> | undefined;
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage(message: Record<string, unknown>) {
        posted = message;
        const result = openCaptureFile(makeTestPcap(), registry, 'plain.pcap');
        const { packets, ...capture } = result;
        queueMicrotask(() => {
          this.onmessage?.({
            data: { type: 'packets', start: 0, packets },
            origin: '',
          } as MessageEvent);
          this.onmessage?.({
            data: { type: 'complete', capture, packetCount: packets.length },
            origin: '',
          } as MessageEvent);
        });
      }
      terminate() {}
    }
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker });
    try {
      const result = await parseCaptureAsync({ data: makeTestPcap(), registry, fileName: 'plain.pcap' });
      expect(result.packets).toHaveLength(2);
      expect(posted).not.toHaveProperty('profile');
    } finally {
      Object.defineProperty(globalThis, 'Worker', { configurable: true, value: originalWorker });
    }
  });

  it('preserves fallback error behavior after a worker error response', async () => {
    const originalWorker = globalThis.Worker;
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage() {
        queueMicrotask(() => this.onmessage?.({
          data: { type: 'error', message: 'worker failed', errorType: 'CaptureReadError' },
          origin: '',
        } as MessageEvent));
      }
      terminate() {}
    }
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker });
    try {
      await expect(parseCaptureAsync({
        data: new Uint8Array([1]),
        registry,
        fileName: 'bad.pcap',
      })).rejects.toThrow('needs at least');
    } finally {
      Object.defineProperty(globalThis, 'Worker', { configurable: true, value: originalWorker });
    }
  });

  it('rejects with UnsupportedLinkTypeError for invalid link types', async () => {
    const stack: StackInstance = { layers: [{ ...newLayer('ethernet'), overrides: {} }] };
    const pktBytes = serializeStack(stack, registry).bytes;
    const data = writePcap([{ bytes: pktBytes, tsSec: 100, tsUsec: 0 }], 999);

    await expect(
      parseCaptureAsync({
        data,
        registry,
        fileName: 'invalid.pcap',
      }),
    ).rejects.toThrow(UnsupportedLinkTypeError);
  });
});
