import { describe, expect, it } from 'vitest';
import { newLayer, type StackInstance } from './model';
import { serializeStack } from './serialize';
import { applicableScenarios, scenarios } from './scenarios';
import { createBuiltinRegistry } from '../protocols';

const registry = createBuiltinRegistry();

const stack = (ids: string[]): StackInstance => ({ layers: ids.map(newLayer) });
const byId = (id: string) => scenarios.find((s) => s.id === id)!;

describe('applicableScenarios', () => {
  it('matches scenarios to the protocols actually in the stack', () => {
    const ids = (s: StackInstance) => applicableScenarios(s, registry).map((x) => x.id);
    expect(ids(stack(['ethernet', 'ipv4', 'udp', 'dns']))).toEqual([
      'single',
      'arp-resolution',
      'dns-query-response',
    ]);
    expect(ids(stack(['ethernet', 'ipv4', 'udp', 'dhcp']))).toEqual([
      'single',
      'arp-resolution',
      'dhcp-dora',
    ]);
    expect(ids(stack(['ethernet', 'arp']))).toEqual(['single']);
  });

  it('single scenario returns the stack unchanged, once', () => {
    const s = stack(['ethernet', 'arp']);
    const plans = byId('single').generate(s, registry);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.stack).toBe(s);
  });
});

describe('dns-query-response', () => {
  const base = stack(['ethernet', 'ipv4', 'udp', 'dns']);
  const plans = byId('dns-query-response').generate(base, registry);
  const [query, response] = plans.map((p) => serializeStack(p.stack, registry));
  const UDP = 34;
  const DNS = 42;

  it('sends the query to port 53 from an ephemeral port', () => {
    const b = query!.bytes;
    expect((b[UDP]! << 8) | b[UDP + 1]!).toBe(49152);
    expect((b[UDP + 2]! << 8) | b[UDP + 3]!).toBe(53);
  });

  it('response flips to come FROM port 53 (binding-resolved, not default)', () => {
    const b = response!.bytes;
    expect((b[UDP]! << 8) | b[UDP + 1]!).toBe(53); // src = 53, the bound value
    expect((b[UDP + 2]! << 8) | b[UDP + 3]!).toBe(49152);
  });

  it('sets QR/RA in the response and includes one answer record', () => {
    const q = query!.bytes;
    const r = response!.bytes;
    expect(q[DNS + 2]! & 0x80).toBe(0); // QR clear in query
    expect(r[DNS + 2]! & 0x80).toBe(0x80); // QR set in response
    expect((r[DNS + 6]! << 8) | r[DNS + 7]!).toBe(1); // ANCOUNT
    // Answer: uncompressed name + type/class/ttl/rdlength + 4-byte address
    expect(r.length - q.length).toBe(13 + 2 + 2 + 4 + 2 + 4);
    // RDATA is the last 4 bytes: 192.0.2.1
    expect([...r.slice(-4)]).toEqual([192, 0, 2, 1]);
  });

  it('answer echoes an overridden question name', () => {
    const custom = stack(['ethernet', 'ipv4', 'udp', 'dns']);
    custom.layers[3]!.overrides['qname'] = 'a.io';
    const [, resp] = byId('dns-query-response').generate(custom, registry);
    const bytes = serializeStack(resp!.stack, registry).bytes;
    const text = new TextDecoder('latin1').decode(bytes);
    // encoded name "\x01a\x02io\x00" appears twice: question + answer
    expect(text.split('\x01a\x02io\x00').length - 1).toBe(2);
  });
});

describe('dhcp-dora', () => {
  const base = stack(['ethernet', 'ipv4', 'udp', 'dhcp']);
  const plans = byId('dhcp-dora').generate(base, registry);
  const packets = plans.map((p) => serializeStack(p.stack, registry));
  const UDP = 34;
  const DHCP = 42;

  it('generates the four DORA messages in order', () => {
    expect(plans.map((p) => p.label)).toEqual(['DISCOVER', 'OFFER', 'REQUEST', 'ACK']);
    expect(plans.map((p) => p.atUsec)).toEqual([0, 30_000, 60_000, 90_000]);
    // option 53 message types: 1, 2, 3, 5
    const msgType = (b: Uint8Array) => b[b.length - 2]; // [53, 1, TYPE, 255]
    expect(packets.map((p) => msgType(p.bytes))).toEqual([1, 2, 3, 5]);
  });

  it('client messages are op=1, server messages op=2 with an offered address', () => {
    const op = (i: number) => packets[i]!.bytes[DHCP];
    expect([op(0), op(1), op(2), op(3)]).toEqual([1, 2, 1, 2]);
    const yiaddr = packets[1]!.bytes.slice(DHCP + 16, DHCP + 20);
    expect([...yiaddr]).toEqual([192, 0, 2, 50]);
  });

  it('server messages come from the DHCP server port', () => {
    const srcPort = (i: number) =>
      (packets[i]!.bytes[UDP]! << 8) | packets[i]!.bytes[UDP + 1]!;
    expect(srcPort(0)).toBe(49152);
    expect(srcPort(1)).toBe(67);
    expect(srcPort(3)).toBe(67);
  });

  it('every generated packet serializes without errors', () => {
    for (const p of packets) {
      expect(p.issues.filter((i) => i.severity === 'error')).toEqual([]);
    }
  });
});
