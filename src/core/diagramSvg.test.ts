import { describe, expect, it } from 'vitest';
import { newLayer } from './model';
import { serializeStack } from './serialize';
import { createBuiltinRegistry } from '../protocols';
import { renderPacketDiagramSvg } from './diagramSvg';

describe('renderPacketDiagramSvg', () => {
  const registry = createBuiltinRegistry();
  const packet = serializeStack(
    { layers: [newLayer('ethernet'), newLayer('ipv4'), newLayer('tcp')] },
    registry,
  );

  it('renders a deterministic, standalone golden packet', () => {
    const svg = renderPacketDiagramSvg(packet, registry, {
      theme: 'print',
      title: 'Golden packet',
    });
    expect(svg).toMatchSnapshot();
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).not.toContain('class=');
    expect(svg).toContain('Ethernet II');
    expect(svg).toContain('IPv4');
    expect(svg).toContain('TCP');
  });

  it('exports one layer with explicit dark styling', () => {
    const ipv4 = packet.layers[1]!;
    const svg = renderPacketDiagramSvg(packet, registry, {
      theme: 'dark',
      layerUid: ipv4.uid,
    });
    expect(svg).toContain('fill="#09090b"');
    expect(svg).toContain('IPv4');
    expect(svg).not.toContain('Ethernet II');
  });

  it('rejects an unknown layer scope', () => {
    expect(() => renderPacketDiagramSvg(packet, registry, { layerUid: 'missing' })).toThrow(
      'No matching packet layers',
    );
  });
});
