import { describe, expect, it } from 'vitest';
import { newLayer, type LayerInstance, type StackInstance } from './model';
import { serializeStack } from './serialize';
import { lintPacket } from './semanticLint';
import { validateStack } from './validate';
import { createBuiltinRegistry } from '../protocols';

const registry = createBuiltinRegistry();

function stackOf(ids: string[]): StackInstance {
  return { layers: ids.map(newLayer), trailingPayload: new Uint8Array(0) };
}

function override(
  layer: LayerInstance,
  fieldId: string,
  value: number | string,
  pinned = false,
): void {
  layer.overrides[fieldId] = value;
  if (pinned) layer.pinned.push(fieldId);
}

function codes(stack: StackInstance): string[] {
  return lintPacket(stack, registry, serializeStack(stack, registry)).map((issue) => issue.code);
}

describe('semantic packet lint', () => {
  it('flags suspicious IPv4 values and anchors every warning to its field', () => {
    const stack = stackOf(['ethernet', 'ipv4']);
    const ipv4 = stack.layers[1]!;
    override(ipv4, 'version', 5);
    override(ipv4, 'ttl', 0);
    override(ipv4, 'flags', 0b100);
    override(ipv4, 'src', '224.0.0.1');

    const issues = lintPacket(stack, registry, serializeStack(stack, registry));
    expect(issues.map((issue) => issue.code)).toEqual([
      'ipv4-version',
      'ipv4-ttl-zero',
      'ipv4-reserved-flag',
      'ipv4-suspicious-source',
    ]);
    expect(issues.every((issue) => issue.layerIndex === 1 && issue.fieldId.length > 0)).toBe(true);
    expect(issues.every((issue) => issue.reference)).toBe(true);
  });

  it('flags suspicious IPv6 header and source values', () => {
    const stack = stackOf(['ethernet', 'ipv6']);
    const ipv6 = stack.layers[1]!;
    override(ipv6, 'version', 4);
    override(ipv6, 'hopLimit', 0);
    override(ipv6, 'src', 'ff02::1');

    expect(codes(stack)).toEqual([
      'ipv6-version',
      'ipv6-hop-limit-zero',
      'ipv6-suspicious-source',
    ]);
  });

  it('only treats loopback addresses as suspicious when carried across a link', () => {
    const raw = stackOf(['ipv4']);
    override(raw.layers[0]!, 'src', '127.0.0.1');
    expect(codes(raw)).not.toContain('ipv4-suspicious-source');

    const linked = stackOf(['ethernet', 'ipv4']);
    override(linked.layers[1]!, 'src', '127.0.0.1');
    expect(codes(linked)).toContain('ipv4-suspicious-source');
  });

  it('detects reserved and contradictory TCP flags', () => {
    const synFin = stackOf(['ethernet', 'ipv4', 'tcp']);
    override(synFin.layers[2]!, 'reserved', 1);
    override(synFin.layers[2]!, 'flags', 0x03);
    expect(codes(synFin)).toEqual(
      expect.arrayContaining(['tcp-reserved-bits', 'tcp-syn-fin']),
    );

    const synRst = stackOf(['ethernet', 'ipv4', 'tcp']);
    override(synRst.layers[2]!, 'flags', 0x06);
    expect(codes(synRst)).toContain('tcp-syn-rst');
  });

  it('prohibits a pinned zero UDP checksum over IPv6 but permits it over IPv4', () => {
    const v6 = stackOf(['ethernet', 'ipv6', 'udp']);
    override(v6.layers[2]!, 'checksum', 0, true);
    expect(codes(v6)).toContain('udp-zero-checksum-ipv6');

    const v4 = stackOf(['ethernet', 'ipv4', 'udp']);
    override(v4.layers[2]!, 'checksum', 0, true);
    expect(codes(v4)).not.toContain('udp-zero-checksum-ipv6');
  });

  it('advises when a known destination port has no modeled application payload', () => {
    const bare = stackOf(['ethernet', 'ipv4', 'tcp']);
    const issue = lintPacket(bare, registry, serializeStack(bare, registry)).find(
      (candidate) => candidate.code === 'tcp-well-known-payload',
    );
    expect(issue?.severity).toBe('advisory');
    expect(issue?.fieldId).toBe('dstPort');

    const modeled = stackOf(['ethernet', 'ipv4', 'tcp', 'http1']);
    expect(codes(modeled)).not.toContain('tcp-well-known-payload');
  });

  it('advises once when a destination port contradicts the carried protocol', () => {
    const stack = stackOf(['ethernet', 'ipv4', 'tcp', 'http1']);
    override(stack.layers[2]!, 'dstPort', 22, true);
    const packet = serializeStack(stack, registry);
    const issues = lintPacket(stack, registry, packet);
    expect(issues.filter((issue) => issue.code === 'tcp-port-payload-mismatch')).toHaveLength(1);
    expect(issues.find((issue) => issue.code === 'tcp-port-payload-mismatch')?.severity).toBe(
      'advisory',
    );
    const combined = validateStack(stack, registry, packet);
    expect(combined.filter((issue) => issue.code === 'tcp-port-payload-mismatch')).toHaveLength(1);
    expect(combined).not.toContainEqual(
      expect.objectContaining({ code: 'pinned-selector-mismatch', layerIndex: 2 }),
    );
  });

  it('does not warn for ordinary default values', () => {
    const stack = stackOf(['ethernet', 'ipv4', 'udp', 'dns']);
    expect(codes(stack)).toEqual([]);
  });
});
