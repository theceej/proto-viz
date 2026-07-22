/**
 * Scenario generators: turn the composed stack into a small, coherent packet
 * sequence (handshakes, request/response pairs) by cloning it with per-packet
 * field overrides. Each generated packet is re-serialized, so lengths and
 * checksums stay correct per packet.
 */
import { newLayer, type FieldValue, type LayerInstance, type StackInstance } from './model';
import type { Registry } from './registry';
import { serializeStack } from './serialize';
import { encodeDnsName, formatIPv6, formatMac, parseIPv6 } from './values';

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
    payload?: Uint8Array;
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
    trailingPayload:
      changes.payload ?? (changes.dropPayload ? new Uint8Array(0) : stack.trailingPayload),
  };
}

const has = (stack: StackInstance, protocolId: string) =>
  stack.layers.some((l) => l.protocolId === protocolId);

const startsWith = (stack: StackInstance, ...protocolIds: string[]) =>
  protocolIds.every((protocolId, index) => stack.layers[index]?.protocolId === protocolId);

function resolvedField(
  values: Map<string, Map<string, FieldValue>>,
  layer: LayerInstance,
  fieldId: string,
  fallback: FieldValue,
): FieldValue {
  return values.get(layer.uid)?.get(fieldId) ?? fallback;
}

function arpResolution(stack: StackInstance, registry: Registry): PacketPlan[] {
  const ethernet = stack.layers[0]!;
  const ipv4 = stack.layers[1]!;
  const values = resolveStackValues(stack, registry);
  const ethSrc = resolvedField(values, ethernet, 'src', '02:00:00:00:00:01');
  const ethDst = resolvedField(values, ethernet, 'dst', '02:00:00:00:00:02');
  const ipSrc = resolvedField(values, ipv4, 'src', '192.0.2.1');
  const ipDst = resolvedField(values, ipv4, 'dst', '192.0.2.2');

  const arpPacket = (
    operation: 1 | 2,
    ethernetSrc: FieldValue,
    ethernetDst: FieldValue,
    senderMac: FieldValue,
    senderIp: FieldValue,
    targetMac: FieldValue,
    targetIp: FieldValue,
  ): StackInstance => {
    const ethernetOverrides = { ...ethernet.overrides };
    delete ethernetOverrides.etherType;
    const arp = newLayer('arp');
    arp.overrides = {
      oper: operation,
      sha: senderMac,
      spa: senderIp,
      tha: targetMac,
      tpa: targetIp,
    };
    return {
      layers: [
        {
          ...ethernet,
          uid: `${ethernet.uid}-arp-${operation}`,
          overrides: { ...ethernetOverrides, src: ethernetSrc, dst: ethernetDst },
          pinned: ethernet.pinned.filter((fieldId) => fieldId !== 'etherType'),
        },
        arp,
      ],
    };
  };

  return [
    {
      label: 'ARP request',
      atUsec: 0,
      stack: arpPacket(
        1,
        ethSrc,
        'ff:ff:ff:ff:ff:ff',
        ethSrc,
        ipSrc,
        '00:00:00:00:00:00',
        ipDst,
      ),
    },
    {
      label: 'ARP reply',
      atUsec: 15_000,
      stack: arpPacket(2, ethDst, ethSrc, ethDst, ipDst, ethSrc, ipSrc),
    },
    { label: 'packet', atUsec: 30_000, stack },
  ];
}

function ndpExchange(stack: StackInstance, registry: Registry): PacketPlan[] {
  const ethernet = stack.layers[0]!;
  const ipv6 = stack.layers[1]!;
  const values = resolveStackValues(stack, registry);
  const ethSrc = resolvedField(values, ethernet, 'src', '02:00:00:00:00:01');
  const ethDst = resolvedField(values, ethernet, 'dst', '02:00:00:00:00:02');
  const ipSrc = resolvedField(values, ipv6, 'src', '2001:db8::1');
  const ipDst = resolvedField(values, ipv6, 'dst', '2001:db8::2');
  const target = typeof ipDst === 'string' ? ipDst : '2001:db8::2';
  const targetBytes = parseIPv6(target);
  const solicitedNode = new Uint8Array(16);
  solicitedNode[0] = 0xff;
  solicitedNode[1] = 0x02;
  solicitedNode[11] = 0x01;
  solicitedNode[12] = 0xff;
  solicitedNode.set(targetBytes.slice(13), 13);
  const multicastMac = formatMac(
    Uint8Array.from([0x33, 0x33, 0xff, ...targetBytes.slice(13)]),
  );

  const packet = (
    type: 135 | 136,
    ethernetSrc: FieldValue,
    ethernetDst: FieldValue,
    ipv6Src: FieldValue,
    ipv6Dst: FieldValue,
    flagsReserved: number,
    optionType: 1 | 2,
    linkLayerAddress: FieldValue,
  ): StackInstance => {
    const ethernetOverrides = { ...ethernet.overrides };
    delete ethernetOverrides.etherType;
    const ipv6Overrides = { ...ipv6.overrides };
    delete ipv6Overrides.nextHeader;
    const ndp = newLayer('icmpv6-ndp');
    ndp.overrides = {
      type,
      flagsReserved,
      targetAddress: target,
      optionType,
      linkLayerAddress,
    };
    return {
      layers: [
        {
          ...ethernet,
          uid: `${ethernet.uid}-ndp-${type}`,
          overrides: { ...ethernetOverrides, src: ethernetSrc, dst: ethernetDst },
          pinned: ethernet.pinned.filter((fieldId) => fieldId !== 'etherType'),
        },
        {
          ...ipv6,
          uid: `${ipv6.uid}-ndp-${type}`,
          overrides: { ...ipv6Overrides, src: ipv6Src, dst: ipv6Dst, hopLimit: 255 },
          pinned: ipv6.pinned.filter((fieldId) => fieldId !== 'nextHeader'),
        },
        ndp,
      ],
    };
  };

  return [
    {
      label: 'Neighbor Solicitation',
      atUsec: 0,
      stack: packet(
        135,
        ethSrc,
        multicastMac,
        ipSrc,
        formatIPv6(solicitedNode),
        0,
        1,
        ethSrc,
      ),
    },
    {
      label: 'Neighbor Advertisement',
      atUsec: 15_000,
      stack: packet(136, ethDst, ethSrc, ipDst, ipSrc, 0x60000000, 2, ethDst),
    },
    { label: 'packet', atUsec: 30_000, stack },
  ];
}

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

const TCP_FLAGS = {
  SYN: 0x02,
  ACK: 0x10,
  SYNACK: 0x12,
  PSHACK: 0x18,
  FINACK: 0x11,
  RSTACK: 0x14,
};

function fullTcpSession(stack: StackInstance, registry: Registry): PacketPlan[] {
  const clientSeq = resolvedNumber(stack, registry, 'tcp', 'seq', 1000);
  const serverSeq = 42_000;
  const clientPayload =
    stack.trailingPayload && stack.trailingPayload.length > 0
      ? stack.trailingPayload
      : new TextEncoder().encode('client data');
  const serverPayload = new TextEncoder().encode('server data');
  const clientAfterData = clientSeq + 1 + clientPayload.length;
  const serverAfterData = serverSeq + 1 + serverPayload.length;

  const packet = (
    label: string,
    atUsec: number,
    flip: boolean,
    flags: number,
    seq: number,
    ack: number,
    payload?: Uint8Array,
  ): PacketPlan => ({
    label,
    atUsec,
    stack: cloneWith(stack, registry, {
      flip,
      dropPayload: payload === undefined,
      payload,
      set: { tcp: { flags, seq, ack } },
    }),
  });

  return [
    packet('SYN', 0, false, TCP_FLAGS.SYN, clientSeq, 0),
    packet('SYN-ACK', 20_000, true, TCP_FLAGS.SYNACK, serverSeq, clientSeq + 1),
    packet('ACK', 40_000, false, TCP_FLAGS.ACK, clientSeq + 1, serverSeq + 1),
    packet(
      'client data',
      60_000,
      false,
      TCP_FLAGS.PSHACK,
      clientSeq + 1,
      serverSeq + 1,
      clientPayload,
    ),
    packet(
      'server data',
      80_000,
      true,
      TCP_FLAGS.PSHACK,
      serverSeq + 1,
      clientAfterData,
      serverPayload,
    ),
    packet(
      'client FIN-ACK',
      100_000,
      false,
      TCP_FLAGS.FINACK,
      clientAfterData,
      serverAfterData,
    ),
    packet(
      'server FIN-ACK',
      120_000,
      true,
      TCP_FLAGS.FINACK,
      serverAfterData,
      clientAfterData + 1,
    ),
    packet(
      'final ACK',
      140_000,
      false,
      TCP_FLAGS.ACK,
      clientAfterData + 1,
      serverAfterData + 1,
    ),
  ];
}

function tlsHandshakeMessage(type: 1 | 2): Uint8Array {
  const random = Uint8Array.from({ length: 32 }, (_, index) => index);
  const body =
    type === 1
      ? Uint8Array.from([
          0x03, 0x03, // TLS 1.2
          ...random,
          0, // session id length
          0, 2, 0, 0x2f, // one TLS_RSA_WITH_AES_128_CBC_SHA cipher suite
          1, 0, // null compression only
          0, 0, // no extensions
        ])
      : Uint8Array.from([
          0x03, 0x03, // TLS 1.2
          ...random,
          0, // session id length
          0, 0x2f, // selected cipher suite
          0, // null compression
          0, 0, // no extensions
        ]);
  return Uint8Array.from([
    type,
    (body.length >>> 16) & 0xff,
    (body.length >>> 8) & 0xff,
    body.length & 0xff,
    ...body,
  ]);
}

function tlsHelloExchange(stack: StackInstance, registry: Registry): PacketPlan[] {
  const tcpIndex = stack.layers.findIndex((layer) => layer.protocolId === 'tcp');
  const tcpLayer = stack.layers[tcpIndex]!;
  const resolved = resolveStackValues(stack, registry);
  const dstPort = resolvedField(resolved, tcpLayer, 'dstPort', 443);
  const transport: StackInstance = {
    layers: stack.layers.slice(0, tcpIndex + 1).map((layer) =>
      layer === tcpLayer
        ? {
            ...layer,
            overrides: { ...layer.overrides, dstPort },
            pinned: [...new Set([...layer.pinned, 'dstPort'])],
          }
        : layer,
    ),
  };
  const clientSeq = resolvedNumber(stack, registry, 'tcp', 'seq', 1000);
  const serverSeq = 42_000;
  const clientHello = tlsHandshakeMessage(1);
  const serverHello = tlsHandshakeMessage(2);
  const clientAfterHello = clientSeq + 1 + 5 + clientHello.length;
  const serverAfterHello = serverSeq + 1 + 5 + serverHello.length;

  const control = (
    label: string,
    atUsec: number,
    flip: boolean,
    flags: number,
    seq: number,
    ack: number,
  ): PacketPlan => ({
    label,
    atUsec,
    stack: cloneWith(transport, registry, {
      flip,
      dropPayload: true,
      set: { tcp: { flags, seq, ack } },
    }),
  });
  const hello = (
    label: string,
    atUsec: number,
    flip: boolean,
    seq: number,
    ack: number,
    payload: Uint8Array,
  ): PacketPlan => ({
    label,
    atUsec,
    stack: cloneWith(stack, registry, {
      flip,
      payload,
      set: { tcp: { flags: TCP_FLAGS.PSHACK, seq, ack }, tls: { contentType: 22 } },
    }),
  });

  return [
    control('SYN', 0, false, TCP_FLAGS.SYN, clientSeq, 0),
    control('SYN-ACK', 20_000, true, TCP_FLAGS.SYNACK, serverSeq, clientSeq + 1),
    control('ACK', 40_000, false, TCP_FLAGS.ACK, clientSeq + 1, serverSeq + 1),
    hello('ClientHello', 60_000, false, clientSeq + 1, serverSeq + 1, clientHello),
    hello('ServerHello', 80_000, true, serverSeq + 1, clientAfterHello, serverHello),
    control(
      'client FIN-ACK',
      100_000,
      false,
      TCP_FLAGS.FINACK,
      clientAfterHello,
      serverAfterHello,
    ),
    control(
      'server FIN-ACK',
      120_000,
      true,
      TCP_FLAGS.FINACK,
      serverAfterHello,
      clientAfterHello + 1,
    ),
    control(
      'final ACK',
      140_000,
      false,
      TCP_FLAGS.ACK,
      clientAfterHello + 1,
      serverAfterHello + 1,
    ),
  ];
}

export const scenarios: Scenario[] = [
  {
    id: 'single',
    name: 'Single packet',
    description: 'Exactly the packet you built, once.',
    applicableWhen: () => true,
    generate: (stack) => [{ label: 'packet', stack, atUsec: 0 }],
  },
  {
    id: 'arp-resolution',
    name: 'ARP resolution + packet',
    description:
      'ARP request and reply for an on-link destination, followed by the IPv4 packet you built.',
    applicableWhen: (stack) => startsWith(stack, 'ethernet', 'ipv4'),
    generate: arpResolution,
  },
  {
    id: 'ndp-exchange',
    name: 'IPv6 neighbor discovery + packet',
    description:
      'Neighbor Solicitation and Advertisement for an on-link destination, followed by the IPv6 packet you built.',
    applicableWhen: (stack) => startsWith(stack, 'ethernet', 'ipv6'),
    generate: ndpExchange,
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
    id: 'tcp-session',
    name: 'Full TCP session',
    description:
      'Handshake, one data segment in each direction, and an orderly FIN/ACK teardown.',
    applicableWhen: (stack) => stack.layers.at(-1)?.protocolId === 'tcp',
    generate: fullTcpSession,
  },
  {
    id: 'tcp-rst',
    name: 'TCP connection refused',
    description:
      'A SYN met with a RST/ACK — the destination port is closed, so the handshake is rejected.',
    applicableWhen: (stack) => has(stack, 'tcp'),
    generate: (stack, registry) => {
      const seq = resolvedNumber(stack, registry, 'tcp', 'seq', 1000);
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
          label: 'RST-ACK',
          atUsec: 15_000,
          stack: cloneWith(stack, registry, {
            flip: true,
            dropPayload: true,
            set: { tcp: { flags: TCP_FLAGS.RSTACK, seq: 0, ack: seq + 1 } },
          }),
        },
      ];
    },
  },
  {
    id: 'tls-hello-exchange',
    name: 'TLS hello exchange',
    description:
      'TCP handshake, byte-valid TLS 1.2 ClientHello and ServerHello records, and teardown.',
    applicableWhen: (stack) =>
      stack.layers.at(-1)?.protocolId === 'tls' && has(stack, 'tcp'),
    generate: tlsHelloExchange,
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
    id: 'icmpv6-ping',
    name: 'ICMPv6 echo request + reply',
    description: 'IPv6 ping and its reply, with addresses flipped and matching id/sequence.',
    applicableWhen: (stack) => has(stack, 'icmpv6'),
    generate: (stack, registry) => [
      {
        label: 'echo request',
        atUsec: 0,
        stack: cloneWith(stack, registry, { set: { icmpv6: { type: 128, code: 0 } } }),
      },
      {
        label: 'echo reply',
        atUsec: 15_000,
        stack: cloneWith(stack, registry, {
          flip: true,
          set: { icmpv6: { type: 129, code: 0 } },
        }),
      },
    ],
  },
  {
    id: 'ntp-exchange',
    name: 'NTP request + response',
    description: 'A client poll (mode 3) and the server’s reply (mode 4), directions flipped.',
    applicableWhen: (stack) => has(stack, 'ntp'),
    generate: (stack, registry) => [
      {
        label: 'client request',
        atUsec: 0,
        stack: cloneWith(stack, registry, { set: { ntp: { mode: 3, stratum: 0 } } }),
      },
      {
        label: 'server response',
        atUsec: 40_000,
        stack: cloneWith(stack, registry, {
          flip: true,
          set: { ntp: { mode: 4, stratum: 2 } },
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
  {
    id: 'dhcpv6-exchange',
    name: 'DHCPv6 Solicit → Reply',
    description:
      'Solicit, Advertise, Request, Reply — the four-message DHCPv6 address assignment.',
    applicableWhen: (stack) => has(stack, 'dhcpv6'),
    generate: (stack, registry) => {
      const msg = (msgType: number) => ({ dhcpv6: { msgType } });
      return [
        { label: 'SOLICIT', atUsec: 0, stack: cloneWith(stack, registry, { set: msg(1) }) },
        {
          label: 'ADVERTISE',
          atUsec: 30_000,
          stack: cloneWith(stack, registry, { flip: true, set: msg(2) }),
        },
        {
          label: 'REQUEST',
          atUsec: 60_000,
          stack: cloneWith(stack, registry, { set: msg(3) }),
        },
        {
          label: 'REPLY',
          atUsec: 90_000,
          stack: cloneWith(stack, registry, { flip: true, set: msg(7) }),
        },
      ];
    },
  },
];

export function applicableScenarios(stack: StackInstance, registry: Registry): Scenario[] {
  return scenarios.filter((s) => s.applicableWhen(stack, registry));
}
