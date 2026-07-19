/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  /** Git commit from which this build was produced. */
  readonly VITE_BUILD_COMMIT: string;
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
