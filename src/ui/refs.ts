/**
 * Linking protocol references (RFC, IEEE, 3GPP, …) to their published specs.
 *
 * Each spec family has a base URL that can be overridden at build time so a
 * deployment can point at a mirror:
 *
 *   VITE_RFC_BASE_URL   https://www.rfc-editor.org/rfc      (deep link /rfc<n>)
 *   VITE_3GPP_BASE_URL  https://www.3gpp.org/DynaReport     (deep link /<series><n>.htm)
 *   VITE_MS_SPECS_BASE_URL  https://learn.microsoft.com/openspecs/windows_protocols
 *   VITE_IEEE_BASE_URL  https://standards.ieee.org          (standards search)
 *
 * IEEE has no stable per-designation deep link (the document URLs use internal
 * ids), so an IEEE reference resolves to a search on that base — still useful,
 * and still redirectable to an institutional mirror.
 */

const strip = (url: string) => url.replace(/\/$/, '');

interface SpecSource {
  base: string;
  match: RegExp;
  url: (m: RegExpExecArray, base: string) => string;
}

const SOURCES: SpecSource[] = [
  {
    base: import.meta.env.VITE_RFC_BASE_URL ?? 'https://www.rfc-editor.org/rfc',
    match: /^RFC (\d+)$/,
    url: (m, base) => `${strip(base)}/rfc${m[1]}`,
  },
  {
    base: import.meta.env.VITE_3GPP_BASE_URL ?? 'https://www.3gpp.org/DynaReport',
    match: /^3GPP TS (\d+)\.(\d+)/,
    url: (m, base) => `${strip(base)}/${m[1]}${m[2]}.htm`,
  },
  {
    base:
      import.meta.env.VITE_MS_SPECS_BASE_URL ??
      'https://learn.microsoft.com/openspecs/windows_protocols',
    match: /^(MS-[A-Z0-9]+)$/,
    url: (m, base) => `${strip(base)}/${m[1]!.toLowerCase()}/`,
  },
  {
    base: import.meta.env.VITE_IEEE_BASE_URL ?? 'https://standards.ieee.org',
    match: /^IEEE (\S+)/,
    url: (m, base) => `${strip(base)}/search/?q=${encodeURIComponent(`IEEE ${m[1]}`)}`,
  },
];

/** Canonical fixed URLs for one-off references (single authoritative source). */
const EXACT: Record<string, string> = {
  'WireGuard whitepaper (Donenfeld)': 'https://www.wireguard.com/papers/wireguard.pdf',
  'MQTT 3.1.1 (OASIS)':
    'https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/os/mqtt-v3.1.1-os.html',
};

/** URL for a spec reference, or null when no linkable source is known. */
export function specUrl(reference: string): string | null {
  const ref = reference.trim();
  if (EXACT[ref]) return EXACT[ref];
  for (const source of SOURCES) {
    const m = source.match.exec(ref);
    if (m) return source.url(m, source.base);
  }
  return null;
}
