import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../protocols/index';
import { newLayer, type StackInstance } from './model';
import { serializeStack } from './serialize';
import { receiverChecksumFindings } from './receiverChecksum';

const registry = createBuiltinRegistry();

/**
 * Build a stack, optionally pinning fields to a wrong value — which is what a
 * hex edit, a pinned field editor value, and a fuzzer mutation all reduce to.
 * `pins` is keyed by protocol id so the tests read as protocol statements.
 */
function build(
  protocolIds: string[],
  pins: Record<string, Record<string, number>> = {},
  payload = new Uint8Array([1, 2, 3, 4]),
) {
  const stack: StackInstance = {
    layers: protocolIds.map((id) => {
      const layer = newLayer(id);
      for (const [fieldId, value] of Object.entries(pins[id] ?? {})) {
        layer.overrides[fieldId] = value;
        layer.pinned.push(fieldId);
      }
      return layer;
    }),
    trailingPayload: payload,
  };
  return { stack, packet: serializeStack(stack, registry) };
}

const findingsFor = (...args: Parameters<typeof build>) => {
  const { stack, packet } = build(...args);
  return receiverChecksumFindings(stack, registry, packet);
};

/** The value a field ends up with on the wire, for building relative pins. */
function wireValue(protocolIds: string[], protocolId: string, fieldId: string): number {
  const { stack, packet } = build(protocolIds);
  const layer = stack.layers.find((l) => l.protocolId === protocolId)!;
  return Number(
    packet.spans.find((span) => span.layerUid === layer.uid && span.fieldId === fieldId)!.value,
  );
}

describe('receiverChecksumFindings', () => {
  it('says nothing about a well-formed packet', () => {
    // The headers tell the truth, so sender and receiver agree exactly. This is
    // the case that must stay silent, or the check is noise on every packet.
    expect(findingsFor(['ethernet', 'ipv4', 'tcp'])).toEqual([]);
    expect(findingsFor(['ethernet', 'ipv4', 'udp'])).toEqual([]);
    expect(findingsFor(['ethernet', 'ipv6', 'tcp'])).toEqual([]);
    expect(findingsFor(['ethernet', 'ipv6', 'udp'])).toEqual([]);
    expect(findingsFor(['ethernet', 'ipv6', 'icmpv6'])).toEqual([]);
  });

  it('catches an overstated IPv4 Total Length', () => {
    const real = wireValue(['ethernet', 'ipv4', 'tcp'], 'ipv4', 'totalLength');
    const findings = findingsFor(['ethernet', 'ipv4', 'tcp'], {
      ipv4: { totalLength: real + 20 },
    });

    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding!.fieldId).toBe('checksum');
    expect(finding!.layerIndex).toBe(2);
    expect(finding!.cause).toContain('Total Length');
    // The wire still carries what the sender computed; a receiver does not.
    expect(finding!.computed).not.toBe(finding!.onWire);
  });

  it('reads UDP’s own Length field, not the IP header (RFC 768)', () => {
    const real = wireValue(['ethernet', 'ipv4', 'udp'], 'udp', 'length');
    const findings = findingsFor(['ethernet', 'ipv4', 'udp'], { udp: { length: real + 8 } });

    expect(findings).toHaveLength(1);
    expect(findings[0]!.cause).toContain('UDP Length');
    expect(findings[0]!.computed).not.toBe(findings[0]!.onWire);
  });

  it('leaves UDP alone when only the IPv4 Total Length is overstated', () => {
    // UDP's pseudo-header length comes from its own header, so an IPv4 lie does
    // not change what a receiver computes for the UDP checksum.
    const real = wireValue(['ethernet', 'ipv4', 'udp'], 'ipv4', 'totalLength');
    expect(findingsFor(['ethernet', 'ipv4', 'udp'], { ipv4: { totalLength: real + 20 } })).toEqual(
      [],
    );
  });

  it('catches an IPv4 Protocol field pointing at the wrong transport', () => {
    const findings = findingsFor(['ethernet', 'ipv4', 'tcp'], { ipv4: { protocol: 17 } });

    expect(findings).toHaveLength(1);
    expect(findings[0]!.cause).toContain('Protocol says 17');
    expect(findings[0]!.cause).toContain('protocol 6');
  });

  it('catches an overstated IPv6 Payload Length', () => {
    const real = wireValue(['ethernet', 'ipv6', 'tcp'], 'ipv6', 'payloadLength');
    const findings = findingsFor(['ethernet', 'ipv6', 'tcp'], {
      ipv6: { payloadLength: real + 16 },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]!.cause).toContain('Payload Length');
    expect(findings[0]!.reference).toContain('RFC 8200');
  });

  it('catches an IPv6 Next Header that disagrees with the layer that follows', () => {
    const findings = findingsFor(['ethernet', 'ipv6', 'icmpv6'], { ipv6: { nextHeader: 6 } });

    expect(findings).toHaveLength(1);
    expect(findings[0]!.cause).toContain('Next Header says 6');
    expect(findings[0]!.cause).toContain('protocol 58');
  });

  it('reports no computable checksum when the claimed length is impossible', () => {
    // 10 bytes of "datagram" is shorter than the IPv4 header itself, so the TCP
    // segment a receiver derives has negative length: it never gets as far as
    // checksumming.
    const findings = findingsFor(['ethernet', 'ipv4', 'tcp'], { ipv4: { totalLength: 10 } });

    expect(findings).toHaveLength(1);
    expect(findings[0]!.computed).toBeNull();
  });

  it('stays silent when a zero UDP checksum says "not computed" (RFC 768)', () => {
    // Zero over IPv4 means the sender declined to checksum, so a receiver skips
    // verification — even though the length field here is a lie.
    const real = wireValue(['ethernet', 'ipv4', 'udp'], 'udp', 'length');
    expect(
      findingsFor(['ethernet', 'ipv4', 'udp'], { udp: { length: real + 8, checksum: 0 } }),
    ).toEqual([]);
  });

  it('stays silent when only the checksum itself was corrupted', () => {
    // Every header field still tells the truth, so a receiver computes exactly
    // what a sender would — the packet is simply carrying a wrong checksum, and
    // serializeStack already warns about that. Reporting it here as well would
    // double up on every "corrupt the checksum" experiment, and would blame the
    // pseudo-header for something that has nothing to do with it.
    const findings = findingsFor(['ethernet', 'ipv4', 'tcp'], { tcp: { checksum: 0xdead } });
    expect(findings).toEqual([]);
  });

  it('stays silent when the inputs diverge but the sum does not', () => {
    // The pseudo-header is a sum of 16-bit words, so +1 on the protocol word
    // and -1 on the length word cancel exactly. The inputs disagree; a receiver
    // computes the same checksum regardless, so there is nothing to report.
    const length = wireValue(['ethernet', 'ipv4', 'tcp'], 'ipv4', 'totalLength');
    expect(
      findingsFor(['ethernet', 'ipv4', 'tcp'], { ipv4: { protocol: 7, totalLength: length - 1 } }),
    ).toEqual([]);
  });

  it('ignores a transport with no enclosing IP layer', () => {
    // serializeStack already warns about this; repeating it here would be noise.
    expect(findingsFor(['udp'])).toEqual([]);
    expect(findingsFor(['ethernet'])).toEqual([]);
  });

  it('follows an in-flight Routing header to the final destination (RFC 8200 §8.1)', () => {
    // With Segments Left > 0 the checksum uses the last address in the segment
    // list, not the one in the IPv6 header. The serializer already does this;
    // if the receiver's view did not, every source-routed packet would be
    // reported as a mismatch.
    const ids = ['ethernet', 'ipv6', 'ipv6-routing', 'tcp'];
    expect(findingsFor(ids)).toEqual([]);

    // And the Payload Length still has to account for the extension header in
    // between, so an overstatement is what shows up rather than the offset.
    const real = wireValue(ids, 'ipv6', 'payloadLength');
    const findings = findingsFor(ids, { ipv6: { payloadLength: real + 12 } });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.cause).toContain('Payload Length');
  });

  it('measures from the transport header when IPv4 options push it along', () => {
    const stack: StackInstance = {
      layers: ['ethernet', 'ipv4', 'tcp'].map((id) => newLayer(id)),
      trailingPayload: new Uint8Array([1, 2, 3, 4]),
    };
    // 4 NOPs grow the IPv4 header to 24 bytes; the derived TCP segment length
    // has to account for them, or every optioned packet would report a mismatch.
    stack.layers[1]!.overrides['options'] = Uint8Array.from([1, 1, 1, 1]);
    const packet = serializeStack(stack, registry);

    expect(receiverChecksumFindings(stack, registry, packet)).toEqual([]);
  });
});
