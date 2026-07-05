import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Base path matches the GitHub Pages URL: https://<user>.github.io/6502-hacker/
export default defineConfig({
  base: '/6502-hacker/',
  // Inline all CSS/JS into index.html: a cached copy of the page can never
  // point at deploy-hashed asset files that no longer exist on Pages.
  plugins: [viteSingleFile()],
  build: {
    // Conservative target: native class fields (es2022) require iOS 14.5+,
    // and dead-silent script failure is the cost of guessing wrong.
    target: 'es2018',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
