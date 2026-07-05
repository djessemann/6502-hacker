import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Base path matches the GitHub Pages URL: https://<user>.github.io/6502-hacker/
export default defineConfig({
  base: '/6502-hacker/',
  // Inline all CSS/JS into index.html: a cached copy of the page can never
  // point at deploy-hashed asset files that no longer exist on Pages.
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
