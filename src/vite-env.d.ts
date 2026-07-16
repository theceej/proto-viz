/// <reference types="vite/client" />

declare module '*.css';
declare module '@fontsource-variable/jetbrains-mono';
declare module 'mammoth/mammoth.browser' {
  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{
    value: string;
    messages: unknown[];
  }>;
}
