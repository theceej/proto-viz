import { describe, expect, it, vi } from 'vitest';
import { createBuiltinRegistry } from '../protocols';
import { parseCaptureAsync } from './captureWorkerClient';
import { UnsupportedLinkTypeError } from './capture';
import { LINKTYPE, writePcap } from './pcap';
import { newLayer, type StackInstance } from './model';
import { serializeStack } from './serialize';

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
