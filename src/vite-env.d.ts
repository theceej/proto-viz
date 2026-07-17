/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for RFC links (set at build time to use a different mirror). */
  readonly VITE_RFC_BASE_URL?: string;
}

declare module '*.css';
declare module '@fontsource-variable/jetbrains-mono';
declare module 'mammoth/mammoth.browser' {
  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{
    value: string;
    messages: unknown[];
  }>;
}
