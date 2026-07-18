import { describe, expect, it } from 'vitest';
import { newLayer } from './model';
import { serializeStack } from './serialize';
import { createBuiltinRegistry } from '../protocols';
import { decodeTcpOptions, encodeTcpOptions } from './tcpOptions';

describe('TCP options', () => {
  const golden = Uint8Array.from([2, 4, 0x05, 0xb4, 4, 2, 8, 10, 0x21, 0x55, 0x0a, 0xe8, 0, 0, 0, 0, 1, 3, 3, 7]);

  it('matches a captured Linux SYN with MSS, SACK, timestamps, and window scale', () => {
    const encoded = encodeTcpOptions({ mss: 1460, sackPermitted: true, timestamp: { value: 0x21550ae8, echoReply: 0 }, windowScale: 7 });
    expect(encoded).toEqual(golden);
    expect(decodeTcpOptions(encoded)).toEqual({ mss: 1460, sackPermitted: true, timestamp: { value: 0x21550ae8, echoReply: 0 }, windowScale: 7 });
  });

  it('updates Data Offset from five to ten words automatically', () => {
    const tcp = newLayer('tcp');
    tcp.overrides.options = golden;
    const packet = serializeStack({ layers: [newLayer('ipv4'), tcp] }, createBuiltinRegistry());
    expect(packet.spans.find((span) => span.layerUid === tcp.uid && span.fieldId === 'dataOffset')?.value).toBe(10);
    expect(packet.bytes.slice(40, 60)).toEqual(golden);
    delete tcp.overrides.options;
    expect(serializeStack({ layers: [newLayer('ipv4'), tcp] }, createBuiltinRegistry()).spans.find((span) => span.layerUid === tcp.uid && span.fieldId === 'dataOffset')?.value).toBe(5);
  });

  it('refuses unknown options so raw bytes remain available', () => {
    expect(decodeTcpOptions(Uint8Array.from([30, 2, 0, 0]))).toBeNull();
  });
});
