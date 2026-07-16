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
  },
});
