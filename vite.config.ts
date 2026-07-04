import { defineConfig } from 'vitest/config';

// Base path matches the GitHub Pages URL: https://<user>.github.io/6502-hacker/
export default defineConfig({
  base: '/6502-hacker/',
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
