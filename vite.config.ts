import { writeFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

// A build id that changes every deploy: the CI commit sha, else a
// timestamp. Baked into the page and written to version.json so a loaded
// page can tell whether it is the current deploy.
const BUILD_ID =
  (process.env.GITHUB_SHA || '').slice(0, 7) ||
  new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

// Emit dist/version.json alongside the inlined single-file page. It is
// fetched (never cached) at runtime for the freshness self-check.
function versionFile(): Plugin {
  return {
    name: 'version-file',
    closeBundle() {
      writeFileSync('dist/version.json', JSON.stringify({ id: BUILD_ID }));
    },
  };
}

// Base path matches the GitHub Pages URL: https://<user>.github.io/6502-hacker/
export default defineConfig({
  base: '/6502-hacker/',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  // Inline all CSS/JS into index.html: a cached copy of the page can never
  // point at deploy-hashed asset files that no longer exist on Pages.
  plugins: [viteSingleFile(), versionFile()],
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
