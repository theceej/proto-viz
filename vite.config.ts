/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Content-Security-Policy for the production build. GitHub Pages can't set
 * response headers, so it ships as a <meta> tag. Everything is same-origin;
 * 'unsafe-inline' styles are needed for React style attributes only.
 * Injected at build time only — the dev server needs HMR inline scripts.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "worker-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

// Relative base so the built app works on GitHub Pages subpaths and any static server.
export default defineConfig(({ command }) => ({
  base: process.env.BASE_URL ?? './',
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'inject-csp',
      transformIndexHtml: {
        order: 'post' as const,
        handler: (html: string) =>
          command === 'build'
            ? html.replace(
                '<meta charset="UTF-8" />',
                `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
              )
            : html,
      },
    },
  ],
  build: { target: 'es2022' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // pdf.js's browser build needs a real Worker; tests run its Node-targeted
    // legacy build instead (same API, in-process worker).
    alias: [{ find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' }],
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/protocols/**', 'src/import/**', 'src/store/**', 'src/ui/format.ts'],
      exclude: ['src/**/*.test.ts', 'src/store/persistence.ts'],
      reporter: ['text-summary', 'text'],
      thresholds: {
        'src/core/**.ts': {
          statements: 90,
          branches: 80,
          functions: 95,
          lines: 94,
        },
        'src/protocols/**.ts': {
          statements: 99,
          branches: 99,
          functions: 99,
          lines: 99,
        },
        'src/import/**.ts': {
          statements: 90,
          branches: 79,
          functions: 99,
          lines: 92,
        },
      },
    },
  },
}));
