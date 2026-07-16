/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Relative base so the built app works on GitHub Pages subpaths and any static server.
export default defineConfig({
  base: process.env.BASE_URL ?? './',
  plugins: [react(), tailwindcss()],
  build: { target: 'es2022' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/protocols/**', 'src/import/**', 'src/store/**', 'src/ui/format.ts'],
      exclude: ['src/**/*.test.ts', 'src/store/persistence.ts'],
      reporter: ['text-summary', 'text'],
    },
  },
});
