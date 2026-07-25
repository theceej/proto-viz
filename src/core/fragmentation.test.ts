import { describe, expect, it } from 'vitest';
import { newLayer, type StackInstance } from './model';
import { serializeStack } from './serialize';
import { createBuiltinRegistry } from '../protocols';
import { encodeIpv4Options } from './ipv4Options';
import {
  analyzeReassembly,
  discoverFragmentableIpLayers,
  fragmentPacket,
  mutateFragmentSequence,
  type FragmentSequence,
} from './fragmentation';

const registry = createBuiltinRegistry();
const bytes = (length: number) => Uint8Array.from({ length }, (_, index) => index & 0xff);
const hex = (value: Uint8Array) => [...value].map((byte) => byte.toString(16).padStart(2, '0')).join('');

function fragment(stack: StackInstance, layerUid: string, mtu: number, identification?: number): FragmentSequence {
  const result = fragmentPacket({ stack, registry, layerUid, mtu, identification });
  expect(result.ok, result.ok ? undefined : result.issues.map((item) => item.message).join('\n')).toBe(true);
  if (!result.ok) throw new Error(result.issues[0]?.message);
  return result.sequence;
}

describe('fragmentPacket IPv4', () => {
  it('produces byte-exact headers, aligned offsets, shared ID, and checksums', () => {
    const ipv4 = newLayer('ipv4');
    ipv4.overrides.identification = 0x1234;
    ipv4.overrides.flags = 0b110;
    const sequence = fragment({ layers: [ipv4], trailingPayload: bytes(24) }, ipv4.uid, 28);

    expect(sequence.fragments.map((item) => hex(item.packet.bytes))).toEqual([
      '4500001c1234200040065c72c0000201c63364010001020304050607',
      '4500001c1234200140065c71c0000201c633640108090a0b0c0d0e0f',
      '4500001c1234000240067c70c0000201c63364011011121314151617',
    ]);
    expect(sequence.fragments.map((item) => [item.offsetBytes, item.payloadLength, item.moreFragments])).toEqual([
      [0, 8, true], [8, 8, true], [16, 8, false],
    ]);
    expect(sequence.fragments.every((item) => item.identification === 0x1234 && item.packet.bytes.length <= 28)).toBe(true);
    expect(sequence.issues).toContainEqual(expect.objectContaining({ code: 'fragment-ipv4-mtu-below-minimum' }));
    expect(sequence.fragments.map((item) => item.packet.bytes[6]! >> 5)).toEqual([1, 1, 0]);
    expect(analyzeReassembly(sequence.fragments).at(-1)?.reassembledPayload).toEqual(bytes(24));
  });

  it('keeps all first-fragment options and only copied-bit options later', () => {
    const ipv4 = newLayer('ipv4');
    ipv4.overrides.options = encodeIpv4Options({ routerAlert: 0, recordRoute: ['192.0.2.9'] });
    const sequence = fragment({ layers: [ipv4], trailingPayload: bytes(32) }, ipv4.uid, 40);

    expect(sequence.fragments[0]!.packet.bytes[0]).toBe(0x48);
    expect(sequence.fragments[1]!.packet.bytes[0]).toBe(0x46);
    expect(sequence.fragments[0]!.packet.bytes.slice(20, 32)).toEqual(ipv4.overrides.options);
    expect(sequence.fragments[1]!.packet.bytes.slice(20, 24)).toEqual(Uint8Array.from([0x94, 4, 0, 0]));
  });

  it('preserves the serialized transport header and checksum byte-for-byte', () => {
    const ipv4 = newLayer('ipv4');
    const tcp = newLayer('tcp');
    const stack = { layers: [ipv4, tcp], trailingPayload: bytes(30) };
    const original = serializeStack(stack, registry);
    const tcpOffset = original.layers[1]!.byteOffset;
    const originalTransport = original.bytes.slice(tcpOffset);
    const sequence = fragment(stack, ipv4.uid, 44);

    expect(sequence.originalPayload).toEqual(originalTransport);
    expect(sequence.fragments[0]!.stack.trailingPayload).toEqual(originalTransport.slice(0, 24));
    expect(sequence.fragments[0]!.stack.layers.some((layer) => layer.protocolId === 'tcp')).toBe(false);
    expect(sequence.fragments[0]!.stack.trailingPayload!.slice(16, 18)).toEqual(originalTransport.slice(16, 18));
    expect(analyzeReassembly(sequence.fragments).at(-1)?.reassembledPayload).toEqual(originalTransport);
  });

  it('accepts the exact usable MTU boundary and rejects one byte less', () => {
    const ipv4 = newLayer('ipv4');
    const stack = { layers: [ipv4], trailingPayload: bytes(17) };
    expect(fragmentPacket({ stack, registry, layerUid: ipv4.uid, mtu: 28 }).ok).toBe(true);
    const failed = fragmentPacket({ stack, registry, layerUid: ipv4.uid, mtu: 27 });
    expect(failed).toMatchObject({ ok: false, issues: [{ code: 'fragment-mtu-too-small' }] });
  });

  it('rejects packets that fit, existing fragments, malformed options, and invalid MTUs', () => {
    const ipv4 = newLayer('ipv4');
    expect(fragmentPacket({ stack: { layers: [ipv4], trailingPayload: bytes(1) }, registry, layerUid: ipv4.uid, mtu: 1500 }))
      .toMatchObject({ ok: false, issues: [{ code: 'fragment-not-needed' }] });
    ipv4.overrides.fragmentOffset = 1;
    expect(fragmentPacket({ stack: { layers: [ipv4], trailingPayload: bytes(20) }, registry, layerUid: ipv4.uid, mtu: 28 }))
      .toMatchObject({ ok: false, issues: [{ code: 'fragment-already-fragmented' }] });
    ipv4.overrides.fragmentOffset = 0;
    ipv4.overrides.options = Uint8Array.from([0x82, 8, 0, 0]);
    expect(fragmentPacket({ stack: { layers: [ipv4], trailingPayload: bytes(20) }, registry, layerUid: ipv4.uid, mtu: 28 }))
      .toMatchObject({ ok: false, issues: [{ code: 'fragment-invalid-options' }] });
    ipv4.overrides.options = Uint8Array.from([0, 1, 0, 0]);
    expect(fragmentPacket({ stack: { layers: [ipv4], trailingPayload: bytes(20) }, registry, layerUid: ipv4.uid, mtu: 28 }))
      .toMatchObject({ ok: false, issues: [{ code: 'fragment-invalid-options' }] });
    expect(fragmentPacket({ stack: { layers: [ipv4] }, registry, layerUid: ipv4.uid, mtu: 1.5 }))
      .toMatchObject({ ok: false, issues: [{ code: 'fragment-invalid-mtu' }] });
  });
});

describe('fragmentPacket IPv6', () => {
  it('produces byte-exact Fragment headers with deterministic identification', () => {
    const ipv6 = newLayer('ipv6');
    const sequence = fragment({ layers: [ipv6], trailingPayload: bytes(24) }, ipv6.uid, 56, 0x01020304);

    expect(sequence.fragments.map((item) => hex(item.packet.bytes))).toEqual([
      '6000000000102c4020010db800000000000000000000000120010db800000000000000000000000206000001010203040001020304050607',
      '6000000000102c4020010db800000000000000000000000120010db8000000000000000000000002060000090102030408090a0b0c0d0e0f',
      '6000000000102c4020010db800000000000000000000000120010db800000000000000000000000206000010010203041011121314151617',
    ]);
    expect(sequence.fragments.map((item) => [item.offsetBytes, item.moreFragments])).toEqual([[0, true], [8, true], [16, false]]);
    expect(sequence.issues).toContainEqual(expect.objectContaining({ code: 'fragment-ipv6-mtu-below-minimum' }));
    expect(analyzeReassembly(sequence.fragments).at(-1)?.reassembledPayload).toEqual(bytes(24));
  });

  it('preserves the unfragmentable extension prefix and fragments from the next header', () => {
    const ipv6 = newLayer('ipv6');
    const hop = newLayer('ipv6-hopopts');
    const routing = newLayer('ipv6-routing');
    const tcp = newLayer('tcp');
    const stack = { layers: [ipv6, hop, routing, tcp], trailingPayload: bytes(24) };
    const original = serializeStack(stack, registry);
    const tcpOffset = original.layers[3]!.byteOffset;
    const sequence = fragment(stack, ipv6.uid, 96, 9);

    expect(sequence.fragments[0]!.stack.layers.map((layer) => layer.protocolId)).toEqual([
      'ipv6', 'ipv6-hopopts', 'ipv6-routing', 'ipv6-frag',
    ]);
    expect(sequence.originalPayload).toEqual(original.bytes.slice(tcpOffset));
    expect(sequence.fragments.every((item) => item.packet.bytes.length <= 96)).toBe(true);
    expect(sequence.fragments[0]!.packet.bytes[6]).toBe(0);
    expect(sequence.fragments[0]!.packet.bytes[40]).toBe(43);
    expect(sequence.fragments[0]!.packet.bytes[48]).toBe(44);
  });

  it('places a post-routing Destination Options header in the fragmentable bytes', () => {
    const ipv6 = newLayer('ipv6');
    const routing = newLayer('ipv6-routing');
    const destination = newLayer('ipv6-dstopts');
    const udp = newLayer('udp');
    const stack = { layers: [ipv6, routing, destination, udp], trailingPayload: bytes(24) };
    const original = serializeStack(stack, registry);
    const destinationOffset = original.layers[2]!.byteOffset;
    const sequence = fragment(stack, ipv6.uid, 88, 10);
    expect(sequence.originalPayload).toEqual(original.bytes.slice(destinationOffset));
    expect(sequence.fragments[0]!.stack.layers.map((layer) => layer.protocolId)).toEqual(['ipv6', 'ipv6-routing', 'ipv6-frag']);
  });

  it('rejects missing IDs, existing Fragment headers, impossible MTUs, and invalid extension layouts', () => {
    const ipv6 = newLayer('ipv6');
    const payload = bytes(32);
    expect(fragmentPacket({ stack: { layers: [ipv6], trailingPayload: payload }, registry, layerUid: ipv6.uid, mtu: 56 }))
      .toMatchObject({ ok: false, issues: [{ code: 'fragment-invalid-identification' }] });
    expect(fragmentPacket({ stack: { layers: [ipv6], trailingPayload: payload }, registry, layerUid: ipv6.uid, mtu: 47, identification: 1 }))
      .toMatchObject({ ok: false, issues: [{ code: 'fragment-mtu-too-small' }] });
    const existing = newLayer('ipv6-frag');
    expect(fragmentPacket({ stack: { layers: [ipv6, existing], trailingPayload: payload }, registry, layerUid: ipv6.uid, mtu: 56, identification: 1 }))
      .toMatchObject({ ok: false, issues: [{ code: 'fragment-already-fragmented' }] });
    const routing = newLayer('ipv6-routing');
    const hop = newLayer('ipv6-hopopts');
    expect(fragmentPacket({ stack: { layers: [ipv6, routing, hop], trailingPayload: payload }, registry, layerUid: ipv6.uid, mtu: 80, identification: 1 }))
      .toMatchObject({ ok: false, issues: [{ code: 'fragment-invalid-ipv6-layout' }] });
  });
});

describe('sequence mutation and prefix reassembly', () => {
  const makeSequence = () => {
    const ipv4 = newLayer('ipv4');
    return fragment({ layers: [ipv4], trailingPayload: bytes(32) }, ipv4.uid, 28);
  };

  it('reports each normal arrival prefix and completes byte-for-byte', () => {
    const sequence = makeSequence();
    const states = analyzeReassembly(sequence.fragments);
    expect(states.slice(0, -1).every((state) => state.status === 'incomplete')).toBe(true);
    expect(states.at(-1)).toMatchObject({ status: 'complete', complete: true });
    expect(states.at(-1)?.reassembledPayload).toEqual(sequence.originalPayload);
  });

  it('treats exact duplicates as recoverable warnings', () => {
    const sequence = mutateFragmentSequence(makeSequence(), 'duplicate', registry);
    const final = analyzeReassembly(sequence.fragments).at(-1)!;
    expect(final.status).toBe('complete');
    expect(final.issues.map((item) => item.code)).toContain('reassembly-exact-duplicate');
    expect(final.reassembledPayload).toEqual(sequence.originalPayload);
  });

  it('accepts out-of-order delivery with informational diagnostics', () => {
    const sequence = mutateFragmentSequence(makeSequence(), 'out-of-order', registry);
    const final = analyzeReassembly(sequence.fragments).at(-1)!;
    expect(final.status).toBe('complete');
    expect(final.issues).toContainEqual(expect.objectContaining({ code: 'reassembly-out-of-order', severity: 'info' }));
  });

  it('leaves missing sequences incomplete and rejects every overlap as ambiguous', () => {
    const missing = mutateFragmentSequence(makeSequence(), 'missing', registry);
    expect(analyzeReassembly(missing.fragments).at(-1)).toMatchObject({ status: 'incomplete', complete: false });
    const overlap = mutateFragmentSequence(makeSequence(), 'overlap', registry);
    expect(analyzeReassembly(overlap.fragments).at(-1)).toMatchObject({ status: 'ambiguous', complete: false });
    expect(hex(overlap.fragments[1]!.packet.bytes)).toBe(
      '4500001c0001200040066ea5c0000201c633640108090a0b0c0d0e0f',
    );
  });

  it('produces a byte-exact malformed IPv6 overlap', () => {
    const ipv6 = newLayer('ipv6');
    const sequence = fragment({ layers: [ipv6], trailingPayload: bytes(32) }, ipv6.uid, 56, 0x01020304);
    const overlap = mutateFragmentSequence(sequence, 'overlap', registry);
    expect(hex(overlap.fragments[1]!.packet.bytes)).toBe(
      '6000000000102c4020010db800000000000000000000000120010db8000000000000000000000002060000010102030408090a0b0c0d0e0f',
    );
    expect(analyzeReassembly(overlap.fragments).at(-1)).toMatchObject({ status: 'ambiguous' });
  });

  it('updates the selected fragment header in nested stacks', () => {
    const outer = newLayer('ipv4');
    const inner = newLayer('ipv4');
    const sequence = fragment({ layers: [outer, inner], trailingPayload: bytes(32) }, inner.uid, 28);
    const overlap = mutateFragmentSequence(sequence, 'overlap', registry);
    const changed = overlap.fragments[1]!;
    expect(changed.stack.layers[0]!.overrides.fragmentOffset).toBeUndefined();
    expect(changed.stack.layers[1]!.overrides.fragmentOffset).toBe(0);
  });

  it('rejects fragments with matching IDs but different endpoint keys', () => {
    const firstIp = newLayer('ipv4');
    const secondIp = newLayer('ipv4');
    secondIp.overrides.dst = '203.0.113.9';
    const first = fragment({ layers: [firstIp], trailingPayload: bytes(32) }, firstIp.uid, 28);
    const second = fragment({ layers: [secondIp], trailingPayload: bytes(32) }, secondIp.uid, 28);
    expect(analyzeReassembly([first.fragments[0]!, ...second.fragments.slice(1)]).at(-1))
      .toMatchObject({ status: 'rejected', issues: [{ code: 'reassembly-datagram-mismatch' }] });
  });

  it('rejects mismatched datagrams, invalid alignment, and inconsistent metadata', () => {
    const sequence = makeSequence();
    const mismatched = sequence.fragments.map((item) => ({ ...item }));
    mismatched[1] = { ...mismatched[1]!, identification: 99 };
    expect(analyzeReassembly(mismatched).at(-1)).toMatchObject({ status: 'rejected', issues: [{ code: 'reassembly-datagram-mismatch' }] });
    const unaligned = sequence.fragments.map((item) => ({ ...item }));
    unaligned[0] = { ...unaligned[0]!, payloadLength: 7, stack: { ...unaligned[0]!.stack, trailingPayload: bytes(7) } };
    expect(analyzeReassembly(unaligned).at(-1)).toMatchObject({ status: 'rejected', issues: [{ code: 'reassembly-invalid-alignment' }] });
    const inconsistent = sequence.fragments.map((item) => ({ ...item }));
    inconsistent[0] = { ...inconsistent[0]!, payloadLength: 99 };
    expect(analyzeReassembly(inconsistent).at(-1)).toMatchObject({ status: 'rejected', issues: [{ code: 'reassembly-invalid-metadata' }] });
  });
});

describe('discovery', () => {
  it('finds nested IPv4 and IPv6 layers by stable UID', () => {
    const outer = newLayer('ipv6');
    const inner = newLayer('ipv4');
    expect(discoverFragmentableIpLayers({ layers: [outer, inner] }, registry)).toEqual([
      { uid: outer.uid, layerIndex: 0, protocolId: 'ipv6', version: 6 },
      { uid: inner.uid, layerIndex: 1, protocolId: 'ipv4', version: 4 },
    ]);
  });
});
