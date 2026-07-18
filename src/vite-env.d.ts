/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Spec-link base URLs, overridable at build time to use different mirrors. */
  readonly VITE_RFC_BASE_URL?: string;
  readonly VITE_3GPP_BASE_URL?: string;
  readonly VITE_MS_SPECS_BASE_URL?: string;
  readonly VITE_IEEE_BASE_URL?: string;
}

declare module '*.css';
declare module '@fontsource-variable/jetbrains-mono';
declare module 'mammoth/mammoth.browser' {
  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{
    value: string;
    messages: unknown[];
  }>;
}
