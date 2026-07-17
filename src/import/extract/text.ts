/**
 * Text extraction for each supported spec format. Every extractor returns
 * plain text plus a flag saying whether monospace column alignment survived
 * (the diagram parser depends on it).
 */
import DOMPurify from 'dompurify';
import { detectFormat, type SpecFormat } from './detect';

export interface ExtractedText {
  text: string;
  format: SpecFormat;
  /** False when column alignment is reconstructed (PDF) or lossy (DOCX). */
  preservedLayout: boolean;
  warnings: string[];
}

export class ExtractError extends Error {}

/** Uploads beyond this are almost certainly not protocol specs. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export async function extractSpecText(file: File): Promise<ExtractedText> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ExtractError(
      `File is ${Math.round(file.size / 1024 / 1024)} MB; the limit is 20 MB. Protocol specs are text — extract the relevant section if yours is larger.`,
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = detectFormat(file.name, bytes);

  switch (format) {
    case 'txt':
      return {
        text: new TextDecoder().decode(bytes),
        format,
        preservedLayout: true,
        warnings: [],
      };
    case 'html':
      return {
        text: extractHtml(new TextDecoder().decode(bytes)),
        format,
        preservedLayout: true,
        warnings: [],
      };
    case 'docx': {
      const { convertToHtml } = await import('mammoth/mammoth.browser');
      const result = await convertToHtml({ arrayBuffer: bytes.buffer as ArrayBuffer });
      return {
        text: extractHtml(result.value),
        format,
        preservedLayout: false,
        warnings: [
          'DOCX layout is approximate — diagrams parse best from the plain-text version of a spec.',
        ],
      };
    }
    case 'pdf':
      return {
        text: await extractPdf(bytes),
        format,
        preservedLayout: false,
        warnings: [
          'PDF column alignment is reconstructed and may be imprecise — prefer the .txt version of RFCs when available.',
        ],
      };
    case 'doc-legacy':
      throw new ExtractError(
        'Binary .doc files cannot be parsed in the browser. Save the document as .docx, PDF, or plain text and upload again.',
      );
    default:
      throw new ExtractError('Unrecognized file format. Upload TXT, HTML, DOCX, or PDF.');
  }
}

/** DOM-based HTML extraction: <pre> blocks verbatim, block elements as lines. */
export function extractHtml(html: string): string {
  // Uploaded specs are untrusted. The DOMParser document is inert and never
  // attached to the page, but sanitizing first makes that safety independent
  // of how the parsed tree is used.
  const clean = DOMPurify.sanitize(html);
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  const parts: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      if (tag === 'pre') {
        parts.push(el.textContent ?? '');
        return;
      }
      if (tag === 'script' || tag === 'style') return;
      for (const child of el.childNodes) walk(child);
      if (/^(p|div|h[1-6]|li|tr|br|table|section|article)$/.test(tag)) parts.push('\n');
    } else if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? '');
    }
  };
  walk(doc.body);
  return parts.join('');
}

/** pdf.js extraction with line reconstruction from glyph coordinates. */
async function extractPdf(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  // isEvalSupported: false — never let embedded font programs reach eval.
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    interface Item {
      str: string;
      x: number;
      y: number;
      width: number;
    }
    const items: Item[] = content.items.flatMap((it) => {
      if (!('str' in it)) return [];
      const t = it as { str: string; transform: number[]; width: number };
      return [{ str: t.str, x: t.transform[4]!, y: t.transform[5]!, width: t.width }];
    });

    // Cluster into lines by y (tolerance 2pt), sort by x.
    const lines = new Map<number, Item[]>();
    for (const item of items) {
      let key: number | undefined;
      for (const y of lines.keys()) if (Math.abs(y - item.y) < 2) key = y;
      if (key === undefined) key = item.y;
      const list = lines.get(key) ?? [];
      list.push(item);
      lines.set(key, list);
    }
    const sortedYs = [...lines.keys()].sort((a, b) => b - a); // top to bottom

    // Median char width for column re-spacing.
    const widths = items
      .filter((i) => i.str.trim().length > 0)
      .map((i) => i.width / Math.max(1, i.str.length));
    widths.sort((a, b) => a - b);
    const charW = widths[Math.floor(widths.length / 2)] ?? 6;

    const pageLines: string[] = [];
    for (const y of sortedYs) {
      const lineItems = lines.get(y)!.sort((a, b) => a.x - b.x);
      const x0 = lineItems[0]!.x;
      let line = '';
      for (const item of lineItems) {
        const col = Math.max(line.length, Math.round((item.x - x0) / charW));
        line = line.padEnd(col) + item.str;
      }
      pageLines.push(line);
    }
    pages.push(pageLines.join('\n'));
  }
  return pages.join('\n\n');
}
