import { describe, expect, it } from 'vitest';
import { newLayer, type StackInstance } from '../core/model';
import { serializeStack } from '../core/serialize';
import { decodeStackBytes } from '../core/decodeStack';
import { validateStack } from '../core/validate';
import { createBuiltinRegistry } from './index';

const registry = createBuiltinRegistry();

function messageStack(message: Uint8Array, tls = false): StackInstance {
  const ids = ['ethernet', 'ipv4', 'tcp', ...(tls ? ['tls'] : []), 'http2', 'grpc'];
  const layers = ids.map(newLayer);
  layers.at(-1)!.overrides.message = message;
  return { layers };
}

describe('gRPC message framing', () => {
  it.each([false, true])('computes nested lengths for edited message bytes (TLS=%s)', (tls) => {
    const message = new Uint8Array([0x0a, 0x03, 0x66, 0x6f, 0x6f]);
    const stack = messageStack(message, tls);
    const packet = serializeStack(stack, registry);
    const grpc = packet.layers.at(-1)!;
    const http2 = packet.layers.at(-2)!;
    expect([...packet.bytes.slice(grpc.byteOffset)]).toEqual([0, 0, 0, 0, 5, ...message]);
    expect([...packet.bytes.slice(http2.byteOffset, http2.byteOffset + 3)]).toEqual([0, 0, 10]);
    if (tls) {
      const record = packet.layers.at(-3)!;
      expect([...packet.bytes.slice(record.byteOffset + 3, record.byteOffset + 5)]).toEqual([0, 19]);
    }
    expect(
      validateStack(stack, registry, packet).filter((issue) => issue.severity === 'error'),
    ).toEqual([]);
  });

  it('supports empty messages and decodes them without losing the zero length', () => {
    const packet = serializeStack(messageStack(new Uint8Array(0)), registry);
    const bytes = packet.bytes.slice(packet.layers.at(-1)!.byteOffset);
    expect([...bytes]).toEqual([0, 0, 0, 0, 0]);
    const decoded = decodeStackBytes(bytes, registry, 'grpc');
    expect(decoded.layers[0]!.overrides.message).toEqual(new Uint8Array(0));
    expect(decoded.exact).toBe(true);
  });

  it('uses a 32-bit big-endian length and preserves compressed bytes without interpreting them', () => {
    const message = new Uint8Array(258).fill(0xff);
    const stack = messageStack(message);
    stack.layers.at(-1)!.overrides.compressed = 1;
    const packet = serializeStack(stack, registry);
    const bytes = packet.bytes.slice(packet.layers.at(-1)!.byteOffset);
    expect([...bytes.slice(0, 5)]).toEqual([1, 0, 0, 1, 2]);
    const decoded = decodeStackBytes(bytes, registry, 'grpc');
    expect(decoded.layers[0]!.overrides).toMatchObject({ compressed: 1, message });
    expect(decoded.exact).toBe(true);
    expect(serializeStack(decoded.stack, registry).bytes).toEqual(bytes);
  });

  it('leaves subsequent stream messages as opaque trailing bytes', () => {
    const bytes = new Uint8Array([0, 0, 0, 0, 1, 0xaa, 0, 0, 0, 0, 1, 0xbb]);
    const decoded = decodeStackBytes(bytes, registry, 'grpc');
    expect(decoded.layers).toHaveLength(1);
    expect(decoded.layers[0]!.overrides.message).toEqual(new Uint8Array([0xaa]));
    expect(decoded.payload).toEqual(bytes.slice(6));
    expect(decoded.exact).toBe(true);
  });

  it.each([
    [0, 0, 0, 0],
    [0, 0, 0, 0, 4, 0xaa],
    [0, 0xff, 0xff, 0xff, 0xff, 0xaa],
  ])('keeps incomplete or truncated framing as raw bytes (%s)', (...values: number[]) => {
    const bytes = new Uint8Array(values);
    const decoded = decodeStackBytes(bytes, registry, 'grpc');
    expect(decoded.layers).toEqual([]);
    expect(decoded.payload).toEqual(bytes);
    expect(decoded.exact).toBe(false);
    expect(decoded.notes[0]).toContain('input ends inside');
  });

  it.each([0, 1, 4])('does not infer gRPC from arbitrary HTTP/2 frame type %s', (type) => {
    const bytes = new Uint8Array([0, 0, 6, type, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0xaa]);
    const decoded = decodeStackBytes(bytes, registry, 'http2');
    expect(decoded.layers.map((layer) => layer.protocolId)).toEqual(['http2']);
    expect(decoded.payload).toEqual(bytes.slice(9));
    expect(decoded.notes.join(' ')).toContain('opaquely');
    expect(decoded.exact).toBe(true);
  });

  it('warns about non-DATA frames, stream zero, padding, and invalid compression flags', () => {
    const stack = messageStack(new Uint8Array([0xaa]));
    const http2 = stack.layers.at(-2)!;
    http2.overrides = { type: 1, streamId: 0, frameFlags: 8 };
    stack.layers.at(-1)!.overrides.compressed = 2;
    const issues = validateStack(stack, registry, serializeStack(stack, registry));
    expect(issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'grpc-http2-data', 'grpc-http2-stream', 'grpc-http2-padding', 'grpc-compressed-flag',
      ]),
    );
    expect(
      issues.filter((issue) => issue.code.startsWith('grpc-'))
        .every((issue) => issue.fieldId && issue.reference),
    ).toBe(true);
  });

  it('requires HTTP/2 carriage rather than raw TCP or a TLS record alone', () => {
    for (const ids of [
      ['ethernet', 'ipv4', 'tcp', 'grpc'],
      ['ethernet', 'ipv4', 'tcp', 'tls', 'grpc'],
    ]) {
      const stack = { layers: ids.map(newLayer) };
      expect(validateStack(stack, registry).map((issue) => issue.code)).toContain('no-binding');
    }
  });
});
