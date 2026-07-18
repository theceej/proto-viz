import type { Registry } from './registry';
import type { FieldSpan, LayerLayout, SerializedPacket } from './serialize';

export type DiagramTheme = 'light' | 'dark' | 'print';

export interface DiagramSvgOptions {
  theme?: DiagramTheme;
  layerUid?: string;
  title?: string;
}

interface Segment {
  span: FieldSpan;
  row: number;
  col: number;
  width: number;
  first: boolean;
  collapsed?: string;
}

const palettes = {
  light: { bg: '#ffffff', ink: '#18181b', muted: '#52525b', grid: '#a1a1aa', fills: ['#e0f2fe', '#fef3c7', '#ede9fe', '#d1fae5', '#ffe4e6', '#ccfbf1'] },
  dark: { bg: '#09090b', ink: '#f4f4f5', muted: '#a1a1aa', grid: '#52525b', fills: ['#0c4a6e', '#78350f', '#4c1d95', '#064e3b', '#881337', '#134e4a'] },
  print: { bg: '#ffffff', ink: '#000000', muted: '#333333', grid: '#000000', fills: ['#ffffff'] },
} as const;

const esc = (value: string) => value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]!);

/** Render a packet diagram as self-contained SVG markup with no CSS dependencies. */
export function renderPacketDiagramSvg(
  packet: SerializedPacket,
  registry: Registry,
  options: DiagramSvgOptions = {},
): string {
  const theme = options.theme ?? 'light';
  const colors = palettes[theme];
  const layers = options.layerUid
    ? packet.layers.filter((layer) => layer.uid === options.layerUid)
    : packet.layers;
  if (layers.length === 0) throw new Error('No matching packet layers to export');

  const colWidth = 26;
  const left = 36;
  const gridWidth = colWidth * 32;
  const rowHeight = 44;
  const blocks = layers.map((layout, index) => {
    const spans = packet.spans.filter((span) => span.layerUid === layout.uid);
    const def = registry.get(layout.protocolId);
    if (!def) throw new Error(`Unknown protocol "${layout.protocolId}"`);
    const computed = computeSegments(spans, layout);
    return { layout, def, index, ...computed };
  });
  const titleHeight = options.title ? 44 : 12;
  const blockHeights = blocks.map((block) => 42 + Math.max(1, block.rowCount) * rowHeight + 18);
  const height = titleHeight + blockHeights.reduce((sum, value) => sum + value, 0) + 12;
  const width = left * 2 + gridWidth;
  let y = titleHeight;
  const body: string[] = [];

  if (options.title) body.push(`<text x="${left}" y="28" font-size="18" font-weight="700">${esc(options.title)}</text>`);
  for (const [blockIndex, block] of blocks.entries()) {
    body.push(`<text x="${left}" y="${y + 15}" font-size="15" font-weight="700">${esc(block.def.name)}</text>`);
    body.push(`<text x="${left + gridWidth}" y="${y + 15}" text-anchor="end" font-size="11" fill="${colors.muted}">${block.layout.headerBytes} bytes · offset ${block.layout.byteOffset}</text>`);
    const rulerY = y + 35;
    for (let bit = 0; bit < 32; bit += 4) body.push(`<text x="${left + bit * colWidth + 2}" y="${rulerY}" font-size="9" fill="${colors.muted}">${bit}</text>`);
    const gridY = y + 42;
    const fill = colors.fills[blockIndex % colors.fills.length]!;
    for (const segment of block.segments) {
      const x = left + segment.col * colWidth;
      const sy = gridY + segment.row * rowHeight;
      const w = segment.width * colWidth;
      body.push(`<rect x="${x}" y="${sy}" width="${w}" height="${rowHeight}" fill="${fill}" stroke="${colors.grid}"/>`);
      const field = block.def.fields.find((candidate) => candidate.id === segment.span.fieldId);
      const label = segment.collapsed ?? field?.name ?? segment.span.fieldId;
      if (segment.collapsed || (segment.first && segment.width >= 3)) {
        body.push(`<text x="${x + w / 2}" y="${sy + 26}" text-anchor="middle" font-size="${segment.collapsed ? 11 : 12}"${segment.collapsed ? ' font-style="italic"' : ' font-weight="600"'}>${esc(label)}</text>`);
      } else if (!segment.first && segment.width >= 4) {
        body.push(`<text x="${x + w / 2}" y="${sy + 26}" text-anchor="middle" font-size="11" fill="${colors.muted}">⋯</text>`);
      }
    }
    y += blockHeights[blockIndex]!;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(options.title ?? 'Packet diagram')}"><rect width="100%" height="100%" fill="${colors.bg}"/><g fill="${colors.ink}" font-family="Inter,Arial,sans-serif">${body.join('')}</g></svg>`;
}

function computeSegments(spans: FieldSpan[], layout: LayerLayout) {
  const raw: Segment[] = [];
  const base = layout.byteOffset * 8;
  for (const span of spans) {
    let rel = span.bitOffset - base;
    let remaining = span.bitLength;
    const mine: Segment[] = [];
    while (remaining > 0) {
      const col = rel % 32;
      const width = Math.min(32 - col, remaining);
      mine.push({ span, row: Math.floor(rel / 32), col, width, first: false });
      rel += width;
      remaining -= width;
    }
    const widest = mine.reduce((best, item) => item.width > best.width ? item : best, mine[0]!);
    if (widest) widest.first = true;
    raw.push(...mine);
  }
  const owners = new Map<number, Segment[]>();
  for (const segment of raw) owners.set(segment.row, [...(owners.get(segment.row) ?? []), segment]);
  const maxRow = raw.reduce((max, segment) => Math.max(max, segment.row), -1);
  const segments: Segment[] = [];
  const rowMap = new Map<number, number>();
  let display = 0;
  for (let row = 0; row <= maxRow;) {
    const current = owners.get(row) ?? [];
    const solo = current.length === 1 && current[0]!.width === 32 && !current[0]!.first ? current[0]! : null;
    let end = row;
    if (solo) while (end + 1 <= maxRow) {
      const next = owners.get(end + 1) ?? [];
      if (next.length === 1 && next[0]!.width === 32 && next[0]!.span === solo.span && !next[0]!.first) end++;
      else break;
    }
    if (solo && end - row >= 2) {
      segments.push({ ...solo, row: display++, collapsed: `⋯ ${(end - row + 1) * 4} bytes` });
      row = end + 1;
    } else {
      rowMap.set(row++, display++);
    }
  }
  for (const segment of raw) {
    const row = rowMap.get(segment.row);
    if (row !== undefined) segments.push({ ...segment, row });
  }
  return { segments, rowCount: display };
}
