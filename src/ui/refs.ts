/**
 * RFC reference linking. The base URL is a build-time setting so deployments
 * can point at a different mirror:
 *
 *   VITE_RFC_BASE_URL=https://datatracker.ietf.org/doc/html npm run build
 *
 * Both rfc-editor.org (the default) and the IETF datatracker serve documents
 * at <base>/rfc<number>.
 */
export const RFC_BASE_URL: string =
  import.meta.env.VITE_RFC_BASE_URL ?? 'https://www.rfc-editor.org/rfc';

/** URL for a reference like "RFC 768", or null for non-RFC references. */
export function rfcUrl(reference: string): string | null {
  const match = /^RFC (\d+)$/.exec(reference.trim());
  return match ? `${RFC_BASE_URL.replace(/\/$/, '')}/rfc${match[1]}` : null;
}
