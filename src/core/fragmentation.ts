import type { LayerInstance, StackInstance } from './model';
import type { Registry } from './registry';
import { serializeStack, type SerializedPacket } from './serialize';

export type IpVersion = 4 | 6;
export const FRAGMENT_MUTATIONS = ['normal', 'missing', 'duplicate', 'overlap', 'out-of-order'] as const;
export type FragmentMutation = (typeof FRAGMENT_MUTATIONS)[number];
export type FragmentIssueSeverity = 'error' | 'warning' | 'info';

export interface FragmentIssue {
  code: string;
  severity: FragmentIssueSeverity;
  message: string;
  fragmentIndex?: number;
}

export interface FragmentableIpLayer {
  uid: string;
  layerIndex: number;
  protocolId: 'ipv4' | 'ipv6';
  version: IpVersion;
}

export interface PacketFragment {
  stack: StackInstance;
  packet: SerializedPacket;
  /** Exact IPv4/Fragment-header layer mutated by malformed experiments. */
  fragmentLayerUid: string;
  /** IP endpoints and upper protocol, which together identify one datagram. */
  reassemblyKey: string;
  version: IpVersion;
  identification: number;
  offsetBytes: number;
  payloadLength: number;
  moreFragments: boolean;
  originalIndex: number;
}

export interface FragmentSequence {
  version: IpVersion;
  identification: number;
  mtu: number;
  layerUid: string;
  originalPayload: Uint8Array;
  fragments: PacketFragment[];
  issues: FragmentIssue[];
}

export type FragmentPacketResult =
  | { ok: true; sequence: FragmentSequence }
  | { ok: false; issues: FragmentIssue[] };

export interface FragmentPacketOptions {
  stack: StackInstance;
  registry: Registry;
  layerUid: string;
  mtu: number;
  /** Required for IPv6 and ignored for IPv4. */
  identification?: number;
}

export interface ReassemblyState {
  arrivalCount: number;
  complete: boolean;
  status: 'incomplete' | 'complete' | 'ambiguous' | 'rejected';
  issues: FragmentIssue[];
  reassembledPayload?: Uint8Array;
}

const IPV4_MAX_TOTAL = 0xffff;
const IPV6_MAX_PAYLOAD = 0xffff;
const IPV6_UNFRAGMENTABLE = new Set(['ipv6-hopopts', 'ipv6-routing']);
const IPV6_EXTENSIONS = new Set([
  'ipv6-hopopts',
  'ipv6-routing',
  'ipv6-dstopts',
  'ipv6-frag',
]);

export function discoverFragmentableIpLayers(
  stack: StackInstance,
  registry: Registry,
): FragmentableIpLayer[] {
  const result: FragmentableIpLayer[] = [];
  stack.layers.forEach((layer, layerIndex) => {
    if (!registry.get(layer.protocolId)) return;
    if (layer.protocolId === 'ipv4') {
      result.push({ uid: layer.uid, layerIndex, protocolId: 'ipv4', version: 4 });
    }
    if (layer.protocolId === 'ipv6') {
      result.push({ uid: layer.uid, layerIndex, protocolId: 'ipv6', version: 6 });
    }
  });
  return result;
}

export function fragmentPacket(options: FragmentPacketOptions): FragmentPacketResult {
  const { stack, registry, layerUid, mtu } = options;
  const selectedIndex = stack.layers.findIndex((layer) => layer.uid === layerUid);
  const selected = stack.layers[selectedIndex];
  if (!selected || (selected.protocolId !== 'ipv4' && selected.protocolId !== 'ipv6')) {
    return failure('fragment-layer-not-found', 'Select an IPv4 or IPv6 layer that exists in the packet.');
  }
  if (!Number.isInteger(mtu) || mtu <= 0) {
    return failure('fragment-invalid-mtu', 'MTU must be a positive whole number of bytes.');
  }
  if (!registry.get('ipv6-frag') && selected.protocolId === 'ipv6') {
    return failure('fragment-missing-protocol', 'The registry does not contain the IPv6 Fragment header definition.');
  }

  let original: SerializedPacket;
  try {
    original = serializeStack(stack, registry);
  } catch (error) {
    return failure('fragment-serialization-failed', `The original packet cannot be serialized: ${(error as Error).message}`);
  }
  if (original.issues.some((issue) => issue.severity === 'error')) {
    return failure('fragment-invalid-packet', 'The original packet has serialization errors and cannot be fragmented.');
  }

  const selectedLayout = original.layers[selectedIndex];
  if (!selectedLayout || selectedLayout.uid !== layerUid) {
    return failure('fragment-invalid-layout', 'The selected layer does not match the serialized packet layout.');
  }
  try {
    if (selected.protocolId === 'ipv4') {
      return fragmentIpv4(stack, registry, selectedIndex, selectedLayout.byteOffset, selectedLayout.headerBytes, original, mtu);
    }
    return fragmentIpv6(stack, registry, selectedIndex, selectedLayout.byteOffset, original, mtu, options.identification);
  } catch (error) {
    return failure('fragment-invalid-layout', `The selected IP layout cannot be fragmented: ${(error as Error).message}`);
  }
}

function fragmentIpv4(
  stack: StackInstance,
  registry: Registry,
  selectedIndex: number,
  ipOffset: number,
  headerBytes: number,
  original: SerializedPacket,
  mtu: number,
): FragmentPacketResult {
  const layer = stack.layers[selectedIndex]!;
  const flags = spanNumber(original, layer.uid, 'flags');
  const oldOffset = spanNumber(original, layer.uid, 'fragmentOffset');
  if ((flags & 1) !== 0 || oldOffset !== 0) {
    return failure('fragment-already-fragmented', 'The selected IPv4 datagram is already a fragment.');
  }
  const totalLength = spanNumber(original, layer.uid, 'totalLength');
  if (totalLength > IPV4_MAX_TOTAL || ipOffset + totalLength > original.bytes.length) {
    return failure('fragment-invalid-length', 'The IPv4 Total Length is outside the serialized packet.');
  }
  if (totalLength <= mtu) {
    return failure('fragment-not-needed', `The IPv4 datagram is ${totalLength} bytes and already fits the ${mtu}-byte MTU.`);
  }

  const payload = original.bytes.slice(ipOffset + headerBytes, ipOffset + totalLength);
  if (payload.length === 0) return failure('fragment-empty-payload', 'An empty IPv4 payload cannot be fragmented.');
  const allOptions = original.bytes.slice(ipOffset + 20, ipOffset + headerBytes);
  const copiedOptions = copiedIpv4Options(allOptions);
  if (!copiedOptions) {
    return failure('fragment-invalid-options', 'IPv4 options are malformed and cannot be copied to later fragments safely.');
  }
  const laterHeaderBytes = 20 + copiedOptions.length;
  const chunks = splitPayload(payload, mtu - headerBytes, mtu - laterHeaderBytes);
  if (!chunks) {
    return failure('fragment-mtu-too-small', `The ${mtu}-byte MTU leaves no aligned IPv4 fragment payload after its headers.`);
  }

  const identification = spanNumber(original, layer.uid, 'identification');
  const protocol = spanNumber(original, layer.uid, 'protocol');
  const reassemblyKey = `4|${spanString(original, layer.uid, 'src')}|${spanString(original, layer.uid, 'dst')}|${protocol}`;
  const fragments: PacketFragment[] = [];
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index]!;
    const fragmentLayer = cloneForFragment(layer, registry);
    fragmentLayer.overrides.identification = identification;
    fragmentLayer.overrides.flags = index < chunks.length - 1 ? 1 : 0;
    fragmentLayer.overrides.fragmentOffset = chunk.offset / 8;
    fragmentLayer.overrides.protocol = protocol;
    fragmentLayer.overrides.options = index === 0 ? allOptions : copiedOptions;
    pin(fragmentLayer, 'identification', 'flags', 'fragmentOffset', 'protocol', 'options');
    const fragmentStack: StackInstance = {
      layers: [...stack.layers.slice(0, selectedIndex).map((item) => cloneForFragment(item, registry)), fragmentLayer],
      trailingPayload: payload.slice(chunk.offset, chunk.offset + chunk.length),
    };
    const packet = serializeStack(fragmentStack, registry);
    fragments.push({
      stack: fragmentStack,
      packet,
      fragmentLayerUid: fragmentLayer.uid,
      reassemblyKey,
      version: 4,
      identification,
      offsetBytes: chunk.offset,
      payloadLength: chunk.length,
      moreFragments: index < chunks.length - 1,
      originalIndex: index,
    });
  }
  const issues = mtu < 68
    ? [issue('fragment-ipv4-mtu-below-minimum', 'IPv4 requires hosts to accept datagrams of at least 68 bytes; this smaller MTU is useful only as a compact lab demonstration.', 'warning')]
    : [];
  return success(4, identification, mtu, layer.uid, payload, fragments, issues);
}

function fragmentIpv6(
  stack: StackInstance,
  registry: Registry,
  selectedIndex: number,
  ipOffset: number,
  original: SerializedPacket,
  mtu: number,
  identification: number | undefined,
): FragmentPacketResult {
  if (!Number.isInteger(identification) || identification! < 0 || identification! > 0xffffffff) {
    return failure('fragment-invalid-identification', 'IPv6 fragmentation requires a 32-bit unsigned identification value.');
  }
  const layoutResult = ipv6UnfragmentableEnd(stack, selectedIndex);
  if ('issue' in layoutResult) return { ok: false, issues: [layoutResult.issue] };
  const unfragmentableEnd = layoutResult.endIndex;
  const selectedLayout = original.layers[selectedIndex]!;
  const lastLayout = original.layers[unfragmentableEnd]!;
  const prefixEnd = lastLayout.byteOffset + lastLayout.headerBytes;
  const payloadLength = spanNumber(original, stack.layers[selectedIndex]!.uid, 'payloadLength');
  const packetEnd = ipOffset + selectedLayout.headerBytes + payloadLength;
  if (payloadLength > IPV6_MAX_PAYLOAD || packetEnd > original.bytes.length || prefixEnd > packetEnd) {
    return failure('fragment-invalid-length', 'The IPv6 Payload Length is outside the serialized packet.');
  }
  if (selectedLayout.headerBytes + payloadLength <= mtu) {
    return failure('fragment-not-needed', `The IPv6 packet is ${selectedLayout.headerBytes + payloadLength} bytes and already fits the ${mtu}-byte MTU.`);
  }

  const fragmentable = original.bytes.slice(prefixEnd, packetEnd);
  if (fragmentable.length === 0) return failure('fragment-empty-payload', 'An empty IPv6 fragmentable part cannot be fragmented.');
  const unfragmentableBytes = prefixEnd - ipOffset;
  const capacity = Math.min(
    mtu - unfragmentableBytes - 8,
    IPV6_MAX_PAYLOAD - (unfragmentableBytes - selectedLayout.headerBytes) - 8,
  );
  const chunks = splitPayload(fragmentable, capacity, capacity);
  if (!chunks) {
    return failure('fragment-mtu-too-small', `The ${mtu}-byte MTU leaves no aligned IPv6 fragment payload after its headers.`);
  }

  const nextHeaderLayer = stack.layers[unfragmentableEnd]!;
  const nextHeader = spanNumber(original, nextHeaderLayer.uid, 'nextHeader');
  const selectedLayer = stack.layers[selectedIndex]!;
  const reassemblyKey = `6|${spanString(original, selectedLayer.uid, 'src')}|${spanString(original, selectedLayer.uid, 'dst')}|${nextHeader}`;
  const fragments: PacketFragment[] = [];
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index]!;
    const prefix = stack.layers.slice(0, unfragmentableEnd + 1).map((item) => cloneForFragment(item, registry));
    const fragmentHeader: LayerInstance = {
      uid: `${stack.layers[selectedIndex]!.uid}-fragment-${index}`,
      protocolId: 'ipv6-frag',
      overrides: {
        nextHeader,
        fragmentOffset: chunk.offset / 8,
        m: index < chunks.length - 1 ? 1 : 0,
        identification: identification!,
      },
      pinned: ['nextHeader', 'fragmentOffset', 'm', 'identification'],
    };
    const fragmentStack: StackInstance = {
      layers: [...prefix, fragmentHeader],
      trailingPayload: fragmentable.slice(chunk.offset, chunk.offset + chunk.length),
    };
    const packet = serializeStack(fragmentStack, registry);
    fragments.push({
      stack: fragmentStack,
      packet,
      fragmentLayerUid: fragmentHeader.uid,
      reassemblyKey,
      version: 6,
      identification: identification!,
      offsetBytes: chunk.offset,
      payloadLength: chunk.length,
      moreFragments: index < chunks.length - 1,
      originalIndex: index,
    });
  }
  const issues = mtu < 1280
    ? [issue('fragment-ipv6-mtu-below-minimum', 'IPv6 links require an MTU of at least 1280 bytes; this smaller MTU is useful only as a compact lab demonstration.', 'warning')]
    : [];
  return success(6, identification!, mtu, stack.layers[selectedIndex]!.uid, fragmentable, fragments, issues);
}

function ipv6UnfragmentableEnd(
  stack: StackInstance,
  selectedIndex: number,
): { endIndex: number } | { issue: FragmentIssue } {
  let endIndex = selectedIndex;
  let sawRouting = false;
  let sawHopByHop = false;
  let sawDestinationBeforeRouting = false;
  let sawDestinationAfterRouting = false;
  let extensionEnd = selectedIndex;
  while (IPV6_EXTENSIONS.has(stack.layers[extensionEnd + 1]?.protocolId ?? '')) extensionEnd++;
  for (let index = selectedIndex + 1; index < stack.layers.length; index++) {
    const id = stack.layers[index]!.protocolId;
    if (!IPV6_EXTENSIONS.has(id)) break;
    if (id === 'ipv6-frag') {
      return { issue: issue('fragment-already-fragmented', 'The selected IPv6 packet already contains a Fragment header.') };
    }
    if (id === 'ipv6-hopopts' && index !== selectedIndex + 1) {
      return { issue: issue('fragment-invalid-ipv6-layout', 'A Hop-by-Hop header must immediately follow the selected IPv6 header.') };
    }
    if (id === 'ipv6-hopopts') {
      if (sawHopByHop) return { issue: issue('fragment-invalid-ipv6-layout', 'An IPv6 packet cannot contain duplicate Hop-by-Hop headers.') };
      sawHopByHop = true;
    }
    if (id === 'ipv6-routing') {
      if (sawRouting) return { issue: issue('fragment-invalid-ipv6-layout', 'This engine does not support duplicate IPv6 Routing headers.') };
      sawRouting = true;
      endIndex = index;
      continue;
    }
    if (id === 'ipv6-dstopts') {
      const routingFollows = stack.layers.slice(index + 1, extensionEnd + 1).some((layer) => layer.protocolId === 'ipv6-routing');
      if (!sawRouting && routingFollows) {
        if (sawDestinationBeforeRouting) return { issue: issue('fragment-invalid-ipv6-layout', 'Only one Destination Options header is supported before the Routing header.') };
        sawDestinationBeforeRouting = true;
        endIndex = index;
      } else {
        if (sawDestinationAfterRouting) return { issue: issue('fragment-invalid-ipv6-layout', 'Only one Destination Options header is supported after the Routing position.') };
        sawDestinationAfterRouting = true;
      }
      continue;
    }
    if (IPV6_UNFRAGMENTABLE.has(id)) endIndex = index;
  }
  return { endIndex };
}

export function mutateFragmentSequence(
  sequence: FragmentSequence,
  mutation: FragmentMutation,
  registry: Registry,
): FragmentSequence {
  const fragments = [...sequence.fragments];
  const issues: FragmentIssue[] = [...sequence.issues];
  if (mutation === 'missing' && fragments.length > 0) {
    const removed = fragments.splice(Math.floor(fragments.length / 2), 1)[0]!;
    issues.push(issue('fragment-sequence-missing', `Fragment at offset ${removed.offsetBytes} was removed.`, 'warning'));
  } else if (mutation === 'duplicate' && fragments.length > 0) {
    const at = Math.min(1, fragments.length - 1);
    fragments.splice(at + 1, 0, cloneFragment(fragments[at]!));
    issues.push(issue('fragment-sequence-duplicate', `Fragment at offset ${fragments[at]!.offsetBytes} was duplicated.`, 'warning'));
  } else if (mutation === 'out-of-order' && fragments.length > 1) {
    [fragments[0], fragments[1]] = [fragments[1]!, fragments[0]!];
    issues.push(issue('fragment-sequence-out-of-order', 'The first two fragments were delivered out of order.', 'info'));
  } else if (mutation === 'overlap' && fragments.length > 1) {
    const target = cloneFragment(fragments[1]!);
    const shifted = Math.max(0, target.offsetBytes - 8);
    setFragmentOffset(target, shifted, registry);
    fragments[1] = target;
    issues.push(issue('fragment-sequence-overlap', `Fragment offset ${target.offsetBytes + 8} was moved to ${shifted}, creating an overlap.`, 'warning'));
  }
  return { ...sequence, fragments, issues };
}

export function analyzeReassembly(fragments: PacketFragment[]): ReassemblyState[] {
  return fragments.map((_, index) => analyzePrefix(fragments.slice(0, index + 1)));
}

function analyzePrefix(fragments: PacketFragment[]): ReassemblyState {
  const issues: FragmentIssue[] = [];
  const first = fragments[0];
  if (!first) return { arrivalCount: 0, complete: false, status: 'incomplete', issues };
  if (fragments.some((fragment) =>
    fragment.version !== first.version ||
    fragment.identification !== first.identification ||
    fragment.reassemblyKey !== first.reassemblyKey)) {
    issues.push(issue('reassembly-datagram-mismatch', 'Fragments do not share one IP version, identification, endpoints, and upper protocol.'));
    return { arrivalCount: fragments.length, complete: false, status: 'rejected', issues };
  }

  const unique: PacketFragment[] = [];
  let previousOffset = -1;
  let ambiguous = false;
  for (let index = 0; index < fragments.length; index++) {
    const fragment = fragments[index]!;
    const bytes = fragment.stack.trailingPayload ?? new Uint8Array(0);
    if (fragment.payloadLength !== bytes.length || fragment.offsetBytes < 0 || !Number.isInteger(fragment.offsetBytes)) {
      issues.push(issue('reassembly-invalid-metadata', 'Fragment metadata does not match its payload bytes.', 'error', index));
      return { arrivalCount: fragments.length, complete: false, status: 'rejected', issues };
    }
    if (fragment.offsetBytes / 8 > 0x1fff || fragment.offsetBytes + bytes.length > 0xffff) {
      issues.push(issue('reassembly-invalid-range', 'A fragment exceeds the IP fragment offset or reassembled-length limit.', 'error', index));
      return { arrivalCount: fragments.length, complete: false, status: 'rejected', issues };
    }
    if (fragment.offsetBytes % 8 !== 0 || (fragment.moreFragments && bytes.length % 8 !== 0)) {
      issues.push(issue('reassembly-invalid-alignment', 'Fragment offsets and every non-final payload must be aligned to 8 bytes.', 'error', index));
      return { arrivalCount: fragments.length, complete: false, status: 'rejected', issues };
    }
    if (fragment.offsetBytes < previousOffset) {
      issues.push(issue('reassembly-out-of-order', `Fragment at offset ${fragment.offsetBytes} arrived out of order.`, 'info', index));
    }
    previousOffset = fragment.offsetBytes;
    const duplicate = unique.find((candidate) =>
      candidate.offsetBytes === fragment.offsetBytes &&
      candidate.moreFragments === fragment.moreFragments &&
      bytesEqual(candidate.stack.trailingPayload ?? new Uint8Array(0), bytes));
    if (duplicate) {
      issues.push(issue('reassembly-exact-duplicate', `An exact duplicate at offset ${fragment.offsetBytes} is ignored.`, 'warning', index));
      continue;
    }
    for (const candidate of unique) {
      if (rangesOverlap(fragment.offsetBytes, bytes.length, candidate.offsetBytes, candidate.payloadLength)) {
        ambiguous = true;
        issues.push(issue('reassembly-overlap', `Fragment at offset ${fragment.offsetBytes} overlaps another fragment; reassembly is ambiguous.`, 'error', index));
        break;
      }
    }
    unique.push(fragment);
  }
  if (ambiguous) return { arrivalCount: fragments.length, complete: false, status: 'ambiguous', issues };

  const ordered = [...unique].sort((a, b) => a.offsetBytes - b.offsetBytes);
  const terminal = ordered.filter((fragment) => !fragment.moreFragments);
  let cursor = 0;
  for (const fragment of ordered) {
    if (fragment.offsetBytes > cursor) {
      issues.push(issue('reassembly-missing-data', `Bytes ${cursor}-${fragment.offsetBytes - 1} have not arrived.`, 'warning'));
      return { arrivalCount: fragments.length, complete: false, status: 'incomplete', issues };
    }
    cursor = fragment.offsetBytes + fragment.payloadLength;
  }
  if (ordered[0]?.offsetBytes !== 0 || terminal.length === 0) {
    issues.push(issue('reassembly-incomplete', 'Reassembly is waiting for the first or final fragment.', 'warning'));
    return { arrivalCount: fragments.length, complete: false, status: 'incomplete', issues };
  }
  if (terminal.length > 1 || terminal[0] !== ordered[ordered.length - 1]) {
    issues.push(issue('reassembly-conflicting-final', 'Fragments disagree about the end of the datagram.'));
    return { arrivalCount: fragments.length, complete: false, status: 'rejected', issues };
  }
  const output = new Uint8Array(cursor);
  for (const fragment of ordered) output.set(fragment.stack.trailingPayload ?? new Uint8Array(0), fragment.offsetBytes);
  return { arrivalCount: fragments.length, complete: true, status: 'complete', issues, reassembledPayload: output };
}

function setFragmentOffset(fragment: PacketFragment, offsetBytes: number, registry: Registry): void {
  const layer = fragment.stack.layers.find((candidate) => candidate.uid === fragment.fragmentLayerUid);
  if (!layer) return;
  layer.overrides.fragmentOffset = offsetBytes / 8;
  pin(layer, 'fragmentOffset');
  fragment.offsetBytes = offsetBytes;
  fragment.packet = serializeStack(fragment.stack, registry);
}

function splitPayload(
  payload: Uint8Array,
  firstCapacity: number,
  laterCapacity: number,
): { offset: number; length: number }[] | null {
  if (firstCapacity < 0 || laterCapacity < 0) return null;
  const chunks: { offset: number; length: number }[] = [];
  let offset = 0;
  while (offset < payload.length) {
    const capacity = chunks.length === 0 ? firstCapacity : laterCapacity;
    const remaining = payload.length - offset;
    let length = Math.min(remaining, capacity);
    if (remaining > capacity) length = Math.floor(capacity / 8) * 8;
    if (length <= 0 || (remaining > length && length % 8 !== 0)) return null;
    chunks.push({ offset, length });
    offset += length;
  }
  return chunks;
}

/** Keep only options whose copied bit is set, preserving their exact bytes and adding EOL padding. */
function copiedIpv4Options(options: Uint8Array): Uint8Array | null {
  const copied: number[] = [];
  for (let offset = 0; offset < options.length;) {
    const kind = options[offset]!;
    if (kind === 0) {
      if (options.slice(offset).some((value) => value !== 0)) return null;
      break;
    }
    if (kind === 1) {
      offset++;
      continue;
    }
    const length = options[offset + 1];
    if (length === undefined || length < 2 || offset + length > options.length) return null;
    if ((kind & 0x80) !== 0) copied.push(...options.slice(offset, offset + length));
    offset += length;
  }
  while (copied.length % 4 !== 0) copied.push(0);
  return Uint8Array.from(copied);
}

function spanNumber(packet: SerializedPacket, layerUid: string, fieldId: string): number {
  const value = packet.spans.find((span) => span.layerUid === layerUid && span.fieldId === fieldId)?.value;
  if (typeof value !== 'number') throw new Error(`missing numeric field ${layerUid}.${fieldId}`);
  return value;
}

function spanString(packet: SerializedPacket, layerUid: string, fieldId: string): string {
  const value = packet.spans.find((span) => span.layerUid === layerUid && span.fieldId === fieldId)?.value;
  if (typeof value !== 'string') throw new Error(`missing string field ${layerUid}.${fieldId}`);
  return value.toLowerCase();
}

function cloneLayer(layer: LayerInstance): LayerInstance {
  return {
    ...layer,
    overrides: Object.fromEntries(Object.entries(layer.overrides).map(([key, value]) => [key, value instanceof Uint8Array ? value.slice() : value])),
    pinned: [...layer.pinned],
  };
}

function cloneForFragment(layer: LayerInstance, registry: Registry): LayerInstance {
  const cloned = cloneLayer(layer);
  const computed = new Set(registry.get(layer.protocolId)?.fields.filter((field) => field.computed).map((field) => field.id));
  cloned.pinned = cloned.pinned.filter((fieldId) => !computed.has(fieldId));
  return cloned;
}

function cloneFragment(fragment: PacketFragment): PacketFragment {
  const stack = {
    layers: fragment.stack.layers.map(cloneLayer),
    trailingPayload: fragment.stack.trailingPayload?.slice(),
  };
  return { ...fragment, stack };
}

function pin(layer: LayerInstance, ...fieldIds: string[]): void {
  for (const fieldId of fieldIds) if (!layer.pinned.includes(fieldId)) layer.pinned.push(fieldId);
}

function success(
  version: IpVersion,
  identification: number,
  mtu: number,
  layerUid: string,
  originalPayload: Uint8Array,
  fragments: PacketFragment[],
  issues: FragmentIssue[] = [],
): FragmentPacketResult {
  return { ok: true, sequence: { version, identification, mtu, layerUid, originalPayload, fragments, issues } };
}

function failure(code: string, message: string): FragmentPacketResult {
  return { ok: false, issues: [issue(code, message)] };
}

function issue(
  code: string,
  message: string,
  severity: FragmentIssueSeverity = 'error',
  fragmentIndex?: number,
): FragmentIssue {
  return { code, severity, message, ...(fragmentIndex === undefined ? {} : { fragmentIndex }) };
}

function rangesOverlap(aOffset: number, aLength: number, bOffset: number, bLength: number): boolean {
  return aOffset < bOffset + bLength && bOffset < aOffset + aLength;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
