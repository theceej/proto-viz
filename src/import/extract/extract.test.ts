// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ExtractError, extractSpecText } from './text';

const file = (name: string, content: string | Uint8Array) =>
  new File([typeof content === 'string' ? content : (content.buffer as ArrayBuffer)], name);

describe('extractSpecText', () => {
  it('passes plain text through untouched with layout preserved', async () => {
    const text = 'RFC 9999\n\n   +-+-+\n   | X |\n   +-+-+\n';
    const result = await extractSpecText(file('spec.txt', text));
    expect(result.format).toBe('txt');
    expect(result.text).toBe(text);
    expect(result.preservedLayout).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('extracts HTML keeping <pre> content verbatim', async () => {
    const result = await extractSpecText(
      file('spec.html', '<html><body><p>Intro</p><pre>  | A |</pre></body></html>'),
    );
    expect(result.format).toBe('html');
    expect(result.text).toContain('  | A |');
    expect(result.text).toContain('Intro');
  });

  it('rejects legacy binary .doc with actionable guidance', async () => {
    const doc = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    await expect(extractSpecText(file('spec.doc', doc))).rejects.toThrow(ExtractError);
    await expect(extractSpecText(file('spec.doc', doc))).rejects.toThrow(/docx, PDF, or plain text/i);
  });

  it('rejects unrecognized binary formats', async () => {
    const junk = Uint8Array.from({ length: 64 }, (_, i) => (i * 37) % 256);
    await expect(extractSpecText(file('mystery.bin', junk))).rejects.toThrow(
      /Unrecognized file format/,
    );
  });
});
