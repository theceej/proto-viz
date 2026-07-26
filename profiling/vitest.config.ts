import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['profiling/capture-node.profile.test.ts'],
    reporters: ['verbose'],
  },
});
