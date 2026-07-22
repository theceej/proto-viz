import type { ProtocolReference } from './types';

const strip = (url: string) => url.replace(/\/$/, '');

export interface ReferenceSource {
  override?: string;
  template: string;
  legacy: (base: string, token: string) => string;
}

export function resolve(source: ReferenceSource, token: string): string {
  if (source.override?.includes('%s')) return source.override.replaceAll('%s', token);
  if (source.override) return source.legacy(source.override, token);
  return source.template.replaceAll('%s', token);
}

const RFC: ReferenceSource = {
  override: import.meta.env.VITE_RFC_BASE_URL,
  template: 'https://www.rfc-editor.org/rfc/rfc%s',
  legacy: (base, token) => `${strip(base)}/rfc${token}`,
};

const IEEE: ReferenceSource = {
  override: import.meta.env.VITE_IEEE_BASE_URL,
  template: 'https://standards.ieee.org/search/?q=%s',
  legacy: (base, token) => `${strip(base)}/search/?q=${token}`,
};

const THREE_GPP: ReferenceSource = {
  override: import.meta.env.VITE_3GPP_BASE_URL,
  template: 'https://www.3gpp.org/DynaReport/%s.htm',
  legacy: (base, token) => `${strip(base)}/${token}.htm`,
};

const MICROSOFT: ReferenceSource = {
  override: import.meta.env.VITE_MS_SPECS_BASE_URL,
  template: 'https://learn.microsoft.com/openspecs/windows_protocols/%s/',
  legacy: (base, token) => `${strip(base)}/${token}/`,
};

export const rfc = (number: number): ProtocolReference => ({
  name: `RFC ${number}`,
  url: resolve(RFC, String(number)),
});

export const ieee = (designation: string): ProtocolReference => ({
  name: `IEEE ${designation}`,
  url: resolve(IEEE, encodeURIComponent(`IEEE ${designation}`)),
});

export const threeGpp = (series: number, specification: number): ProtocolReference => ({
  name: `3GPP TS ${series}.${specification}`,
  url: resolve(THREE_GPP, `${series}${specification}`),
});

export const microsoft = (name: string): ProtocolReference => ({
  name,
  url: resolve(MICROSOFT, name.toLowerCase()),
});

/** Backward-compatible linking for name-only references on custom protocols. */
export function referenceFromName(name: string): ProtocolReference {
  const rfcMatch = /^RFC (\d+)$/.exec(name);
  if (rfcMatch) return rfc(Number(rfcMatch[1]));
  const ieeeMatch = /^IEEE (\S+)$/.exec(name);
  if (ieeeMatch) return ieee(ieeeMatch[1]!);
  const threeGppMatch = /^3GPP TS (\d+)\.(\d+)$/.exec(name);
  if (threeGppMatch) return threeGpp(Number(threeGppMatch[1]), Number(threeGppMatch[2]));
  if (/^MS-[A-Z0-9]+$/.test(name)) return microsoft(name);
  return { name };
}
