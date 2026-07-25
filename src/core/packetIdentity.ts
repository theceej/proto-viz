/**
 * Reading a packet's *identity* — who sent it, who it is for, and which
 * transport endpoints it uses — from a serialized packet's field spans.
 *
 * Both the scenario timeline (which infers direction between endpoints) and
 * the capture viewer (which groups packets into flows) need this, and both
 * need it to agree: an address read one way here and another way there would
 * silently split a conversation in two.
 */
import type { SerializedPacket } from './serialize';

/**
 * Address-bearing layers in the order we prefer to read a packet's identity
 * from: network layer first (the real path), then ARP's protocol addresses,
 * then the link layer as a last resort.
 */
const ADDRESS_LAYERS: { protocolId: string; src: string; dst: string }[] = [
  { protocolId: 'ipv4', src: 'src', dst: 'dst' },
  { protocolId: 'ipv6', src: 'src', dst: 'dst' },
  { protocolId: 'arp', src: 'spa', dst: 'tpa' },
  { protocolId: 'ethernet', src: 'src', dst: 'dst' },
  { protocolId: 'ethernet-8023', src: 'src', dst: 'dst' },
];

/** Transport layers whose `srcPort`/`dstPort` complete an endpoint pair. */
const PORT_LAYERS = ['tcp', 'udp', 'sctp'];

export interface PacketEndpoints {
  src: string;
  dst: string;
}

/** The source/destination identity of a packet, or null if none is readable. */
export function packetEndpoints(packet: SerializedPacket): PacketEndpoints | null {
  for (const spec of ADDRESS_LAYERS) {
    const layer = packet.layers.find((l) => l.protocolId === spec.protocolId);
    if (!layer) continue;
    const spans = packet.spans.filter((s) => s.layerUid === layer.uid);
    const src = spans.find((s) => s.fieldId === spec.src)?.value;
    const dst = spans.find((s) => s.fieldId === spec.dst)?.value;
    if (typeof src === 'string' && typeof dst === 'string') return { src, dst };
  }
  return null;
}

export interface PacketPorts {
  protocolId: string;
  src: number;
  dst: number;
}

/**
 * The outermost transport ports of a packet, or null when it carries none.
 * Outermost wins so a tunnelled packet is attributed to the tunnel it
 * actually travelled over.
 */
export function packetPorts(packet: SerializedPacket): PacketPorts | null {
  for (const layer of packet.layers) {
    if (!PORT_LAYERS.includes(layer.protocolId)) continue;
    const spans = packet.spans.filter((s) => s.layerUid === layer.uid);
    const src = spans.find((s) => s.fieldId === 'srcPort')?.value;
    const dst = spans.find((s) => s.fieldId === 'dstPort')?.value;
    if (typeof src === 'number' && typeof dst === 'number') {
      return { protocolId: layer.protocolId, src, dst };
    }
  }
  return null;
}
