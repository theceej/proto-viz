/**
 * Prose fallback: scan spec text for "Name: N bits" / "Name (N octets)"
 * style field declarations. Used when no diagram parses, and to cross-check
 * diagram widths.
 */

export interface ProseField {
  name: string;
  bits: number;
  line: number;
}

const PATTERNS = [
  // "Version:  4 bits", "Header Checksum: 16 bits"
  /^\s{0,8}([A-Z][A-Za-z0-9 /-]{1,40}?)\s*:\s+(\d{1,3})\s+(bit|bits|octet|octets|byte|bytes)\b/,
  // "Total Length (16 bits)"
  /^\s{0,8}([A-Z][A-Za-z0-9 /-]{1,40}?)\s*\(\s*(\d{1,3})\s+(bit|bits|octet|octets|byte|bytes)\s*\)/,
];

export function findProseFields(text: string): ProseField[] {
  const out: ProseField[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const re of PATTERNS) {
      const m = re.exec(line);
      if (m) {
        const n = Number(m[2]);
        const unit = m[3]!.startsWith('bit') ? 1 : 8;
        out.push({ name: m[1]!.trim(), bits: n * unit, line: i });
        break;
      }
    }
  });
  return out;
}
