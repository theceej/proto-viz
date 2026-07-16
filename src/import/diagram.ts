/**
 * Heuristic parser for RFC-style ASCII packet diagrams:
 *
 *      0                   1                   2                   3
 *      0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 *     +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 *     |Version|  IHL  |Type of Service|          Total Length         |
 *     +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 *
 * Handles the classic 2-chars-per-bit style plus width variants (RFC 768's
 * 1-char-per-bit, DNS's 16-bit 3-chars-per-bit rows) via a column→bit ratio
 * derived from the border width and the bit ruler. Never trusted blindly:
 * every parse carries a confidence score and per-field flags for review.
 */

export interface ParsedField {
  name: string;
  bitOffset: number;
  bitLength: number;
  variable: boolean;
  flags: string[]; // 'misaligned' | 'unnamed' | 'merged' | 'variable-marker'
}

export interface DiagramParse {
  startLine: number;
  endLine: number;
  bitsPerRow: number;
  totalBits: number;
  fields: ParsedField[];
  confidence: number; // 0..1
  warnings: string[];
}

const isBorderLine = (line: string): boolean => {
  const t = line.trim();
  if (t.length < 5) return false;
  if (!/^\+[-+ ]*\+$/.test(t)) return false;
  return (t.match(/-/g) ?? []).length >= 4;
};

const isContentLine = (line: string): boolean => {
  const t = line.trim();
  return (t.startsWith('|') || t.startsWith('/')) && (t.endsWith('|') || t.endsWith('/'));
};

const isRulerLine = (line: string): boolean => {
  const t = line.trim();
  return t.length > 0 && /^[\d ]+$/.test(t);
};

export function findDiagrams(text: string): DiagramParse[] {
  const lines = text.split(/\r?\n/);
  const results: DiagramParse[] = [];

  let i = 0;
  while (i < lines.length) {
    if (!isBorderLine(lines[i]!)) {
      i++;
      continue;
    }
    // Collect the region: borders and content lines.
    const start = i;
    let end = i;
    while (
      end + 1 < lines.length &&
      (isBorderLine(lines[end + 1]!) || isContentLine(lines[end + 1]!))
    ) {
      end++;
    }
    const region = lines.slice(start, end + 1);
    if (region.filter(isBorderLine).length >= 2 && region.some(isContentLine)) {
      // Ruler lines directly above the region (up to 3).
      const rulers: string[] = [];
      for (let k = start - 1; k >= Math.max(0, start - 3); k--) {
        if (isRulerLine(lines[k]!)) rulers.unshift(lines[k]!);
        else break;
      }
      const parse = parseRegion(region, rulers, start, end);
      if (parse && parse.fields.length > 0) results.push(parse);
    }
    i = end + 1;
  }
  return results;
}

function parseRegion(
  region: string[],
  rulers: string[],
  startLine: number,
  endLine: number,
): DiagramParse | null {
  const warnings: string[] = [];
  let penalty = 0;

  // Bits per row from the ones-digit ruler (32 tokens for the classic style).
  let bitsPerRow = 32;
  const onesRuler = rulers[rulers.length - 1];
  if (onesRuler) {
    const tokens = onesRuler.trim().split(/\s+/).map(Number);
    const strictlyIncreasing = tokens.every((t, i) => i === 0 || t > tokens[i - 1]!);
    if (tokens.every((t) => t <= 9) && tokens.length >= 8 && tokens.length <= 64) {
      // Classic ones-digit line: "0 1 2 ... 9 0 1 ..." — one token per bit.
      bitsPerRow = tokens.length;
    } else if (strictlyIncreasing && tokens.length >= 2) {
      // Labeled boundaries: "0  7 8  15 16  23 24  31" — last label + 1.
      bitsPerRow = tokens[tokens.length - 1]! + 1;
    }
  } else {
    warnings.push('No bit ruler found; assuming 32 bits per row.');
    penalty += 0.1;
  }

  const firstBorder = region.find(isBorderLine)!;
  const anchor = firstBorder.indexOf('+');
  const innerWidth = firstBorder.lastIndexOf('+') - anchor;
  if (innerWidth < bitsPerRow) return null;
  const ratio = innerWidth / bitsPerRow;

  // Group content lines between borders.
  interface Group {
    lines: string[];
    variable: boolean;
  }
  const groups: Group[] = [];
  let current: string[] = [];
  for (const line of region) {
    if (isBorderLine(line)) {
      if (current.length > 0) groups.push({ lines: current, variable: false });
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) groups.push({ lines: current, variable: false });

  const fields: ParsedField[] = [];
  let misalignedCount = 0;

  groups.forEach((group, rowIndex) => {
    // Use the line with the most separators for cell boundaries.
    const sepPositions = (line: string): number[] => {
      const out: number[] = [];
      for (let c = 0; c < line.length; c++) {
        const ch = line[c]!;
        if (ch === '|' || ch === '/') out.push(c);
      }
      return out;
    };
    const best = group.lines.reduce((a, b) =>
      sepPositions(b).length > sepPositions(a).length ? b : a,
    );
    const positions = sepPositions(best);
    if (positions.length < 2) return;

    const usesSlash = group.lines.some((l) => l.trim().startsWith('/') || l.trim().endsWith('/'));

    // Map separator columns to bit boundaries.
    const boundaries: { bit: number; misaligned: boolean }[] = positions.map((col) => {
      const raw = (col - anchor) / ratio;
      const bit = Math.round(raw);
      const misaligned = Math.abs(raw - bit) > 0.2;
      return { bit: Math.max(0, Math.min(bitsPerRow, bit)), misaligned };
    });

    for (let b = 0; b + 1 < boundaries.length; b++) {
      const from = boundaries[b]!;
      const to = boundaries[b + 1]!;
      const width = to.bit - from.bit;
      if (width <= 0) continue;

      // Join the cell text across all lines of the group.
      const text = group.lines
        .map((l) => l.slice(positions[b]! + 1, positions[b + 1]!).trim())
        .filter((t) => t.length > 0)
        .join(' ')
        .replace(/\s+/g, ' ');

      const flags: string[] = [];
      if (from.misaligned || to.misaligned) {
        flags.push('misaligned');
        misalignedCount++;
      }
      const variable = usesSlash || /\.\.\.|···/.test(text);
      if (variable) flags.push('variable-marker');

      fields.push({
        name: text.replace(/\s*\.\.\.\s*/g, '').trim(),
        bitOffset: rowIndex * bitsPerRow + from.bit,
        bitLength: width,
        variable,
        flags,
      });
    }
  });

  // Merge continuation rows into the field above: an unnamed (or same-named)
  // cell spanning the same columns directly below an existing field.
  const merged: ParsedField[] = [];
  for (const field of fields) {
    const prev = merged[merged.length - 1];
    const prevEnd = prev ? prev.bitOffset + prev.bitLength : -1;
    const sameColumns =
      prev !== undefined &&
      prevEnd === field.bitOffset &&
      prev.bitOffset % bitsPerRow === field.bitOffset % bitsPerRow &&
      prev.bitLength >= field.bitLength;
    const continuation =
      sameColumns && (field.name === '' || field.name.toLowerCase() === prev.name.toLowerCase());
    // Full-width rows chain even when the column check is looser.
    const fullRowChain =
      prev !== undefined &&
      prevEnd === field.bitOffset &&
      field.name === '' &&
      field.bitLength === bitsPerRow;
    if (prev && (continuation || fullRowChain)) {
      prev.bitLength += field.bitLength;
      if (!prev.flags.includes('merged')) prev.flags.push('merged');
      prev.variable = prev.variable || field.variable;
      continue;
    }
    merged.push({ ...field });
  }

  let unnamed = 0;
  merged.forEach((f, idx) => {
    if (f.name === '') {
      f.name = `field${idx + 1}`;
      f.flags.push('unnamed');
      unnamed++;
    }
  });

  const totalBits = merged.reduce((n, f) => n + f.bitLength, 0);
  if (totalBits % 8 !== 0) {
    warnings.push(`Total size is ${totalBits} bits — not a whole number of bytes.`);
    penalty += 0.2;
  }
  const expectedEnd = merged.length > 0
    ? merged[merged.length - 1]!.bitOffset + merged[merged.length - 1]!.bitLength
    : 0;
  if (expectedEnd !== totalBits) {
    warnings.push('Fields have gaps or overlaps; check offsets in review.');
    penalty += 0.2;
  }

  penalty += Math.min(0.4, misalignedCount * 0.08);
  penalty += Math.min(0.3, unnamed * 0.08);
  const wordLike = merged.filter((f) => /^[A-Za-z]/.test(f.name)).length;
  if (merged.length > 0 && wordLike / merged.length < 0.5) penalty += 0.2;

  return {
    startLine,
    endLine,
    bitsPerRow,
    totalBits,
    fields: merged,
    confidence: Math.max(0.05, Math.min(1, 1 - penalty)),
    warnings,
  };
}
