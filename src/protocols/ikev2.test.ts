import { describe, expect, it } from 'vitest';
import { decodeStackBytes } from '../core/decodeStack';
import { lintPacket } from '../core/semanticLint';
import { newLayer, type StackInstance } from '../core/model';
import { serializeStack } from '../core/serialize';
import { createBuiltinRegistry } from './index';

const registry = createBuiltinRegistry();

function ikeStack(protocolId: 'ikev2' | 'ikev2-natt', payload = new Uint8Array(0)): StackInstance {
  return {
    layers: ['ethernet', 'ipv4', 'udp', protocolId].map(newLayer),
    trailingPayload: payload,
  };
}

describe('IKEv2', () => {
  it('writes the RFC 7296 header and computes its message length', () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const stack = ikeStack('ikev2', payload);
    const packet = serializeStack(stack, registry);
    const ike = packet.layers.at(-1)!;
    const header = packet.bytes.subarray(ike.byteOffset, ike.byteOffset + ike.headerBytes);

    expect(ike.headerBytes).toBe(28);
    expect([...header.subarray(0, 8)]).toEqual([0x49, 0x4b, 0x45, 0x76, 0x32, 0, 0, 1]);
    expect(header[16]).toBe(0);
    expect(header[17]).toBe(0x20);
    expect(header[18]).toBe(34);
    expect(header[19]).toBe(0x08);
    expect(new DataView(header.buffer, header.byteOffset).getUint32(24)).toBe(32);
  });

  it('adds a Non-ESP marker on UDP 4500 without counting it in IKE Length', () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const stack = ikeStack('ikev2-natt', payload);
    const packet = serializeStack(stack, registry);
    const ike = packet.layers.at(-1)!;
    const header = packet.bytes.subarray(ike.byteOffset, ike.byteOffset + ike.headerBytes);

    expect(ike.headerBytes).toBe(32);
    expect([...header.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    expect(new DataView(header.buffer, header.byteOffset).getUint32(28)).toBe(32);
  });

  it.each([
    ['ikev2', 500],
    ['ikev2-natt', 4500],
  ] as const)('binds and decodes %s on UDP %i', (protocolId, port) => {
    const stack = ikeStack(protocolId);
    const packet = serializeStack(stack, registry);
    const udpLayer = stack.layers[2]!;
    const dstPort = packet.spans.find(
      (span) => span.layerUid === udpLayer.uid && span.fieldId === 'dstPort',
    );

    expect(dstPort?.value).toBe(port);
    expect(decodeStackBytes(packet.bytes, registry, 'ethernet').layers.map((layer) => layer.protocolId))
      .toEqual(['ethernet', 'ipv4', 'udp', protocolId]);
  });

  it('warns about invalid IKEv2 versions and NAT-T markers', () => {
    const stack = ikeStack('ikev2-natt');
    const ike = stack.layers.at(-1)!;
    ike.overrides.majorVersion = 1;
    ike.overrides.minorVersion = 1;
    ike.overrides.nonEspMarker = 1;
    const packet = serializeStack(stack, registry);

    expect(lintPacket(stack, registry, packet).map((issue) => issue.code)).toEqual([
      'ikev2-major-version',
      'ikev2-minor-version',
      'ikev2-natt-marker',
    ]);
  });
});
