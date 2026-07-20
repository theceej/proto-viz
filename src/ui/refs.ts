/**
 * Linking protocol references (RFC, IEEE, 3GPP, …) to their published specs.
 *
 * Each spec family resolves through a URL *template* containing `%s`, which is
 * replaced by the reference's identifier — the same idea as a browser's
 * keyword-search URL. Templates are overridable at build time so a deployment
 * can point at a mirror whose paths are shaped differently (the number in the
 * middle, a `.txt` suffix, no `rfc` prefix, …), not just at a different host:
 *
 *   VITE_RFC_BASE_URL       https://www.rfc-editor.org/rfc/rfc%s
 *   VITE_3GPP_BASE_URL      https://www.3gpp.org/DynaReport/%s.htm
 *   VITE_MS_SPECS_BASE_URL  https://learn.microsoft.com/openspecs/windows_protocols/%s/
 *   VITE_IEEE_BASE_URL      https://standards.ieee.org/search/?q=%s
 *
 * For backward compatibility an override with no `%s` is treated as a base URL
 * and the family's default deep-link tail is appended, so the earlier
 * base-only overrides keep resolving exactly as before.
 *
 * IEEE has no stable per-designation deep link (document URLs use internal
 * ids), so its default template runs a standards search; a mirror can point
 * this at a direct-link scheme instead.
 */

const strip = (url: string) => url.replace(/\/$/, '');

export interface SpecSource {
  /** Build-time override (env var), if set. */
  override?: string;
  /** Default URL template with a single `%s` placeholder. */
  template: string;
  /** Matches a reference string and captures its identifier parts. */
  match: RegExp;
  /** The `%s` substitution derived from a match. */
  token: (m: RegExpExecArray) => string;
  /** Composition for a base-only (no `%s`) override — the pre-template scheme. */
  legacy: (base: string, token: string) => string;
}

const SOURCES: SpecSource[] = [
  {
    override: import.meta.env.VITE_RFC_BASE_URL,
    template: 'https://www.rfc-editor.org/rfc/rfc%s',
    match: /^RFC (\d+)$/,
    token: (m) => m[1]!,
    legacy: (base, t) => `${strip(base)}/rfc${t}`,
  },
  {
    override: import.meta.env.VITE_3GPP_BASE_URL,
    template: 'https://www.3gpp.org/DynaReport/%s.htm',
    match: /^3GPP TS (\d+)\.(\d+)/,
    token: (m) => `${m[1]}${m[2]}`,
    legacy: (base, t) => `${strip(base)}/${t}.htm`,
  },
  {
    override: import.meta.env.VITE_MS_SPECS_BASE_URL,
    template: 'https://learn.microsoft.com/openspecs/windows_protocols/%s/',
    match: /^(MS-[A-Z0-9]+)$/,
    token: (m) => m[1]!.toLowerCase(),
    legacy: (base, t) => `${strip(base)}/${t}/`,
  },
  {
    override: import.meta.env.VITE_IEEE_BASE_URL,
    template: 'https://standards.ieee.org/search/?q=%s',
    match: /^IEEE (\S+)/,
    token: (m) => encodeURIComponent(`IEEE ${m[1]}`),
    legacy: (base, t) => `${strip(base)}/search/?q=${t}`,
  },
];

export function resolve(source: SpecSource, token: string): string {
  const { override } = source;
  if (override?.includes('%s')) return override.replaceAll('%s', token);
  if (override) return source.legacy(override, token);
  return source.template.replaceAll('%s', token);
}

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
    if (m) return resolve(source, source.token(m));
  }
  return null;
}
