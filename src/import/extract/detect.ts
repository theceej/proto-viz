/** File-format sniffing for uploaded specs. */

export type SpecFormat = 'txt' | 'html' | 'docx' | 'pdf' | 'doc-legacy' | 'unknown';

export function detectFormat(name: string, bytes: Uint8Array): SpecFormat {
  const head = bytes.slice(0, 8);
  const ascii = new TextDecoder('latin1').decode(bytes.slice(0, 512)).toLowerCase();

  if (startsWith(head, [0x25, 0x50, 0x44, 0x46])) return 'pdf'; // %PDF
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'doc-legacy';
  if (startsWith(head, [0x50, 0x4b])) {
    // ZIP container: .docx (or another OOXML). Extension decides.
    if (name.toLowerCase().endsWith('.docx')) return 'docx';
    return 'docx'; // best guess for PK-container uploads here
  }
  if (ascii.includes('<html') || ascii.includes('<!doctype html')) return 'html';
  if (name.toLowerCase().endsWith('.html') || name.toLowerCase().endsWith('.htm')) return 'html';
  if (name.toLowerCase().endsWith('.doc')) return 'doc-legacy';
  // Printable text heuristic.
  const sample = bytes.slice(0, 1024);
  let printable = 0;
  for (const b of sample) if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)) printable++;
  if (sample.length > 0 && printable / sample.length > 0.9) return 'txt';
  return 'unknown';
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((b, i) => bytes[i] === b);
}
