import { describe, expect, it } from 'vitest';
import { newLayer, type StackInstance } from './model';
import { serializeStack } from './serialize';
import { applicableScenarios, scenarios } from './scenarios';
import { createBuiltinRegistry } from '../protocols';

const registry = createBuiltinRegistry();

const stack = (ids: string[], payload?: string): StackInstance => ({
  layers: ids.map(newLayer),
  trailingPayload: payload ? new TextEncoder().encode(payload) : undefined,
});

const byId = (id: string) => scenarios.find((s) => s.id === id)!;

describe('scenarios', () => {
  it('offers only applicable scenarios', () => {
    const ids = applicableScenarios(stack(['ethernet', 'ipv4', 'udp']), registry).map(
      (s) => s.id,
    );
    expect(ids).toContain('single');
    expect(ids).not.toContain('tcp-handshake');
    expect(ids).not.toContain('icmp-ping');
  });

  it('generates a coherent TCP three-way handshake', () => {
    const plans = byId('tcp-handshake').generate(
      stack(['ethernet', 'ipv4', 'tcp'], 'GET / HTTP/1.1'),
      registry,
    );
    expect(plans.map((p) => p.label)).toEqual(['SYN', 'SYN-ACK', 'ACK']);

    const pkts = plans.map((p) => serializeStack(p.stack, registry));
    // handshake packets carry no payload
    for (const p of pkts) expect(p.bytes.length).toBe(14 + 20 + 20);

    const tcpAt = 34;
    const flags = pkts.map((p) => p.bytes[tcpAt + 13]!);
    expect(flags).toEqual([0x02, 0x12, 0x10]); // SYN, SYN|ACK, ACK

    // SYN-ACK flips MAC + IP + ports
    const syn = pkts[0]!.bytes;
    const synAck = pkts[1]!.bytes;
    expect([...synAck.slice(0, 6)]).toEqual([...syn.slice(6, 12)]); // dst = old src
    expect([...synAck.slice(26, 30)]).toEqual([...syn.slice(30, 34)]); // ipsrc = old dst
    expect([...synAck.slice(tcpAt, tcpAt + 2)]).toEqual([...syn.slice(tcpAt + 2, tcpAt + 4)]);

    // seq/ack arithmetic
    const u32 = (b: Uint8Array, o: number) =>
      ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
    const seq = u32(syn, tcpAt + 4);
    expect(u32(synAck, tcpAt + 8)).toBe(seq + 1); // SYN-ACK acks SYN+1
    expect(u32(pkts[2]!.bytes, tcpAt + 4)).toBe(seq + 1); // final ACK seq
  });

  it('generates an ICMP echo pair with flipped addresses', () => {
    const plans = byId('icmp-ping').generate(
      stack(['ethernet', 'ipv4', 'icmp'], 'abcdefgh'),
      registry,
    );
    const [req, rep] = plans.map((p) => serializeStack(p.stack, registry));
    expect(req!.bytes[34]).toBe(8); // echo request
    expect(rep!.bytes[34]).toBe(0); // echo reply
    expect([...rep!.bytes.slice(26, 30)]).toEqual([...req!.bytes.slice(30, 34)]);
    // both keep the payload
    expect(req!.bytes.length).toBe(rep!.bytes.length);
  });

  it('re-serializes each packet with fresh checksums', () => {
    const plans = byId('icmp-ping').generate(stack(['ethernet', 'ipv4', 'icmp']), registry);
    const [req, rep] = plans.map((p) => serializeStack(p.stack, registry));
    const ck = (b: Uint8Array) => (b[36]! << 8) | b[37]!;
    expect(ck(req!.bytes)).not.toBe(ck(rep!.bytes)); // type byte changed => checksum changed
    expect(req!.issues).toEqual([]);
    expect(rep!.issues).toEqual([]);
  });
});
