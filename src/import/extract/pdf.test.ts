// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { GlobalWorkerOptions } from 'pdfjs-dist';
import { extractSpecText } from './text';

// pdf.js 6 uses Promise.try — in every evergreen browser, but not Node 22.
if (!('try' in Promise)) {
  (Promise as unknown as { try: (fn: () => unknown) => Promise<unknown> }).try = (fn) =>
    new Promise((resolve) => resolve(fn()));
}

// Node has no Worker; point pdf.js's fake-worker fallback at the real file
// (in the browser, extractPdf resolves the bundled worker via ?url).
GlobalWorkerOptions.workerSrc = pathToFileURL(
  join(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs'),
).href;

describe('extractSpecText pdf', () => {
  it('extracts text lines with column alignment from a PDF', async () => {
    const bytes = readFileSync(join(__dirname, '../../../fixtures/sample.pdf'));
    const file = new File([new Uint8Array(bytes)], 'sample.pdf');
    const result = await extractSpecText(file);
    expect(result.format).toBe('pdf');
    expect(result.preservedLayout).toBe(false);
    expect(result.text).toContain('RFC 9999 Test Document');
    expect(result.text).toContain('+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+');
    expect(result.text).toContain('Version');
  });
});
