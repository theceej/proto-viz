import { useMemo, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import { renderPacketDiagramSvg, type DiagramTheme } from '../../core/diagramSvg';
import type { Registry } from '../../core/registry';
import type { SerializedPacket } from '../../core/serialize';
import { useEscape, useModalFocus } from '../a11y';

export default function DiagramExportDialog({ packet, registry, onClose }: { packet: SerializedPacket; registry: Registry; onClose: () => void }) {
  const [scope, setScope] = useState('all');
  const [theme, setTheme] = useState<DiagramTheme>('print');
  const [format, setFormat] = useState<'svg' | 'png'>('svg');
  const ref = useRef<HTMLDivElement>(null);
  useEscape(true, onClose);
  useModalFocus(ref);
  const svg = useMemo(() => renderPacketDiagramSvg(packet, registry, { theme, layerUid: scope === 'all' ? undefined : scope, title: scope === 'all' ? 'Packet stack' : undefined }), [packet, registry, scope, theme]);

  const download = async () => {
    const base = scope === 'all' ? 'packet-stack' : `${packet.layers.find((layer) => layer.uid === scope)?.protocolId ?? 'packet'}-diagram`;
    if (format === 'svg') downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${base}.svg`);
    else downloadBlob(await rasterize(svg), `${base}.png`);
    onClose();
  };

  return <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60" onClick={onClose}>
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="diagram-export-title" className="w-[28rem] rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <header className="flex items-center border-b border-zinc-800 px-5 py-3"><h2 id="diagram-export-title" className="text-[14px] font-semibold text-zinc-100">Export diagram</h2><button className="ml-auto cursor-pointer rounded p-1.5 text-zinc-500 hover:text-zinc-200" aria-label="Close diagram export dialog" onClick={onClose}><X className="size-4" /></button></header>
      <div className="flex flex-col gap-4 px-5 py-4">
        <label className="text-[12px] text-zinc-400">Content<select className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-200" value={scope} onChange={(event) => setScope(event.target.value)}><option value="all">Whole stack</option>{packet.layers.map((layer) => <option key={layer.uid} value={layer.uid}>{registry.get(layer.protocolId)?.name ?? layer.protocolId}</option>)}</select></label>
        <label className="text-[12px] text-zinc-400">Theme<select className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-200" value={theme} onChange={(event) => setTheme(event.target.value as DiagramTheme)}><option value="print">Print (black on white)</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
        <fieldset><legend className="mb-1 text-[12px] text-zinc-400">Format</legend><div className="flex gap-4 text-[13px] text-zinc-200">{(['svg', 'png'] as const).map((value) => <label key={value} className="flex items-center gap-1.5"><input type="radio" checked={format === value} onChange={() => setFormat(value)} />{value.toUpperCase()}{value === 'png' ? ' (2×)' : ''}</label>)}</div></fieldset>
        <div
          className="max-h-52 overflow-auto rounded border border-zinc-700 bg-white p-2"
          tabIndex={0}
          aria-label="Diagram preview"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      <footer className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3"><button className="cursor-pointer px-3 py-1.5 text-[13px] text-zinc-400" onClick={onClose}>Cancel</button><button className="flex cursor-pointer items-center gap-1.5 rounded-md bg-cyan-700 px-3 py-1.5 text-[13px] font-medium text-white" onClick={() => void download()}><Download className="size-3.5" />Download {format.toUpperCase()}</button></footer>
    </div>
  </div>;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function rasterize(svg: string): Promise<Blob> {
  const image = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Could not render SVG')); image.src = url; });
  URL.revokeObjectURL(url);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth * 2;
  canvas.height = image.naturalHeight * 2;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas export is unavailable');
  context.scale(2, 2);
  context.drawImage(image, 0, 0);
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not encode PNG')), 'image/png'));
}
