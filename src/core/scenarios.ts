/**
 * Scenario generators: turn the composed stack into a small, coherent packet
 * sequence (handshakes, request/response pairs) by cloning it with per-packet
 * field overrides. Each generated packet is re-serialized, so lengths and
 * checksums stay correct per packet.
 */
import type { FieldValue, LayerInstance, StackInstance } from './model';
import type { Registry } from './registry';
import { serializeStack } from './serialize';
import { encodeDnsName } from './values';

/**
 * Post-serialization field values per layer uid — the source of truth for
 * flips, so binding-computed selectors (e.g. UDP dstPort auto-set to 53 by
 * DNS) flip to their real values rather than their static defaults.
 */
function resolveStackValues(
  stack: StackInstance,
  registry: Registry,
): Map<string, Map<string, FieldValue>> {
  const map = new Map<string, Map<string, FieldValue>>();
  try {
    const packet = serializeStack(stack, registry);
    for (const span of packet.spans) {
      let layer = map.get(span.layerUid);
      if (!layer) {
        layer = new Map();
        map.set(span.layerUid, layer);
      }
      layer.set(span.fieldId, span.value);
    }
  } catch {
    // fall back to defaults-only resolution
  }
  return map;
}

export interface PacketPlan {
  label: string;
  stack: StackInstance;
  /** Microseconds after the scenario's base timestamp. */
  atUsec: number;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  applicableWhen(stack: StackInstance, registry: Registry): boolean;
  generate(stack: StackInstance, registry: Registry): PacketPlan[];
}

type Overrides = Record<string, Record<string, FieldValue>>; // protocolId -> fieldId -> value

function cloneWith(
  stack: StackInstance,
  registry: Registry,
  changes: {
    flip?: boolean;
    set?: Overrides;
    dropPayload?: boolean;
  },
): StackInstance {
  const resolvedValues = changes.flip ? resolveStackValues(stack, registry) : new Map();
  const layers = stack.layers.map((layer): LayerInstance => {
    const def = registry.get(layer.protocolId);
    let overrides = { ...layer.overrides };

    const resolved = (fieldId: string): FieldValue | undefined =>
      overrides[fieldId] ??
      resolvedValues.get(layer.uid)?.get(fieldId) ??
      def?.fields.find((f) => f.id === fieldId)?.default;

    if (changes.flip && def) {
      const swap = (a: string, b: string) => {
        const av = resolved(a);
        const bv = resolved(b);
        if (av !== undefined && bv !== undefined) {
          overrides = { ...overrides, [a]: bv, [b]: av };
        }
      };
      if (def.id === 'ethernet') swap('src', 'dst');
      if (def.id === 'ipv4' || def.id === 'ipv6') swap('src', 'dst');
      if (def.id === 'tcp' || def.id === 'udp') swap('srcPort', 'dstPort');
    }

    const set = changes.set?.[layer.protocolId];
    if (set) overrides = { ...overrides, ...set };

    // Pin any explicitly set fields that are normally computed (e.g. a
    // flipped dstPort must not be re-bound to the app protocol's port).
    const pinned = new Set(layer.pinned);
    if (def) {
      for (const fieldId of Object.keys(overrides)) {
        if (def.fields.find((f) => f.id === fieldId)?.computed) pinned.add(fieldId);
      }
    }

    return { ...layer, overrides, pinned: [...pinned] };
  });

  return {
    layers,
    trailingPayload: changes.dropPayload ? new Uint8Array(0) : stack.trailingPayload,
  };
}

const has = (stack: StackInstance, protocolId: string) =>
  stack.layers.some((l) => l.protocolId === protocolId);

function resolvedNumber(
  stack: StackInstance,
  registry: Registry,
  protocolId: string,
  fieldId: string,
  fallback: number,
): number {
  const layer = stack.layers.find((l) => l.protocolId === protocolId);
  if (!layer) return fallback;
  const v =
    layer.overrides[fieldId] ??
    registry.get(protocolId)?.fields.find((f) => f.id === fieldId)?.default;
  return typeof v === 'number' ? v : fallback;
}

const TCP_FLAGS = { SYN: 0x02, ACK: 0x10, SYNACK: 0x12, PSHACK: 0x18, FIN: 0x01 };

export const scenarios: Scenario[] = [
  {
    id: 'single',
    name: 'Single packet',
    description: 'Exactly the packet you built, once.',
    applicableWhen: () => true,
    generate: (stack) => [{ label: 'packet', stack, atUsec: 0 }],
  },
  {
    id: 'tcp-handshake',
    name: 'TCP three-way handshake',
    description: 'SYN, SYN-ACK, ACK with consistent sequence numbers and flipped directions.',
    applicableWhen: (stack) => has(stack, 'tcp'),
    generate: (stack, registry) => {
      const seq = resolvedNumber(stack, registry, 'tcp', 'seq', 1000);
      const peerSeq = 42000;
      return [
        {
          label: 'SYN',
          atUsec: 0,
          stack: cloneWith(stack, registry, {
            dropPayload: true,
            set: { tcp: { flags: TCP_FLAGS.SYN, seq, ack: 0 } },
          }),
        },
        {
          label: 'SYN-ACK',
          atUsec: 20_000,
          stack: cloneWith(stack, registry, {
            flip: true,
            dropPayload: true,
            set: { tcp: { flags: TCP_FLAGS.SYNACK, seq: peerSeq, ack: seq + 1 } },
          }),
        },
        {
          label: 'ACK',
          atUsec: 40_000,
          stack: cloneWith(stack, registry, {
            dropPayload: true,
            set: { tcp: { flags: TCP_FLAGS.ACK, seq: seq + 1, ack: peerSeq + 1 } },
          }),
        },
      ];
    },
  },
  {
    id: 'icmp-ping',
    name: 'ICMP echo request + reply',
    description: 'Ping and its reply, with addresses flipped and matching id/sequence.',
    applicableWhen: (stack) => has(stack, 'icmp'),
    generate: (stack, registry) => [
      {
        label: 'echo request',
        atUsec: 0,
        stack: cloneWith(stack, registry, { set: { icmp: { type: 8, code: 0 } } }),
      },
      {
        label: 'echo reply',
        atUsec: 15_000,
        stack: cloneWith(stack, registry, {
          flip: true,
          set: { icmp: { type: 0, code: 0 } },
        }),
      },
    ],
  },
  {
    id: 'dns-query-response',
    name: 'DNS query + response',
    description: 'A query and its response (QR bit set, one A-record answer added).',
    applicableWhen: (stack) => has(stack, 'dns'),
    generate: (stack, registry) => {
      // Build an uncompressed A-record answer echoing the question name.
      const dnsLayer = stack.layers.find((l) => l.protocolId === 'dns');
      const qname =
        (dnsLayer?.overrides['qname'] as string | undefined) ??
        (registry.get('dns')?.fields.find((f) => f.id === 'qname')?.default as string) ??
        'example.com';
      const name = encodeDnsName(qname);
      const answer = Uint8Array.from([
        ...name,
        0, 1, // TYPE A
        0, 1, // CLASS IN
        0, 0, 1, 44, // TTL 300
        0, 4, // RDLENGTH
        192, 0, 2, 1, // 192.0.2.1
      ]);
      return [
        {
          label: 'query',
          atUsec: 0,
          stack: cloneWith(stack, registry, { set: { dns: { qr: 0, rd: 1 } } }),
        },
        {
          label: 'response',
          atUsec: 24_000,
          stack: cloneWith(stack, registry, {
            flip: true,
            set: { dns: { qr: 1, rd: 1, ra: 1, ancount: 1, records: answer } },
          }),
        },
      ];
    },
  },
  {
    id: 'dhcp-dora',
    name: 'DHCP DORA exchange',
    description: 'Discover, Offer, Request, Ack — the full address-assignment handshake.',
    applicableWhen: (stack) => has(stack, 'dhcp'),
    generate: (stack, registry) => {
      const msg = (type: number) => Uint8Array.from([53, 1, type, 255]);
      const client = (type: number) => ({
        dhcp: { op: 1, options: msg(type) },
      });
      const server = (type: number) => ({
        dhcp: { op: 2, yiaddr: '192.0.2.50', options: msg(type) },
      });
      return [
        { label: 'DISCOVER', atUsec: 0, stack: cloneWith(stack, registry, { set: client(1) }) },
        {
          label: 'OFFER',
          atUsec: 30_000,
          stack: cloneWith(stack, registry, { flip: true, set: server(2) }),
        },
        {
          label: 'REQUEST',
          atUsec: 60_000,
          stack: cloneWith(stack, registry, { set: client(3) }),
        },
        {
          label: 'ACK',
          atUsec: 90_000,
          stack: cloneWith(stack, registry, { flip: true, set: server(5) }),
        },
      ];
    },
  },
];

export function applicableScenarios(stack: StackInstance, registry: Registry): Scenario[] {
  return scenarios.filter((s) => s.applicableWhen(stack, registry));
}
