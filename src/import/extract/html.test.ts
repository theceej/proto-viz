// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { extractHtml } from './text';
import { findDiagrams } from '../diagram';

// DOMPurify needs a real browser DOM; under happy-dom it mangles markup
// (style content becomes bare text, script tags pass through). These tests
// cover the extraction walker, which must handle unsanitized HTML anyway —
// so sanitize becomes identity here and DOMPurify is trusted upstream.
vi.mock('dompurify', () => ({
  default: { sanitize: (html: string) => html },
}));

describe('extractHtml', () => {
  it('preserves <pre> blocks verbatim so diagrams survive', () => {
    const diagram = [
      '    0                   1                   2                   3',
      '    0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1',
      '   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+',
      '   |          Source Port          |       Destination Port        |',
      '   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+',
      '   |                        Sequence Number                        |',
      '   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+',
    ].join('\n');
    const html = `<html><body><h1>Spec</h1><p>Intro text.</p><pre>${diagram}</pre><p>After.</p></body></html>`;
    const text = extractHtml(html);
    expect(text).toContain('Source Port');
    const parses = findDiagrams(text);
    expect(parses).toHaveLength(1);
    expect(parses[0]!.fields.map((f) => f.name)).toEqual([
      'Source Port',
      'Destination Port',
      'Sequence Number',
    ]);
  });

  it('strips active content from hostile uploads but keeps their text', () => {
    const text = extractHtml(
      '<html><body>' +
        '<p>Before</p>' +
        '<img src="x" onerror="alert(1)">' +
        '<svg onload="alert(2)"></svg>' +
        '<a href="javascript:alert(3)" onclick="alert(4)">link text</a>' +
        '<pre>|  Version  |</pre>' +
        '<p>After</p>' +
        '</body></html>',
    );
    expect(text).not.toContain('alert(');
    expect(text).toContain('Before');
    expect(text).toContain('link text');
    expect(text).toContain('|  Version  |');
    expect(text).toContain('After');
  });

  it('drops script/style content and keeps block structure', () => {
    const text = extractHtml(
      '<html><body><style>.x{}</style><script>var x=1;</script><p>One</p><p>Two</p></body></html>',
    );
    expect(text).not.toContain('var x');
    expect(text).not.toContain('.x{}');
    expect(text).toMatch(/One\s*\n[\s\S]*Two/);
  });
});
