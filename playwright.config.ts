import { defineConfig } from '@playwright/test';

export default defineConfig({
  // Load-bearing, not tidiness. Playwright's default testDir is the repo root
  // and its default match includes .mjs, so without this it collects
  // scripts/prune_remote_code.test.mjs and src/**/*.test.ts -- vitest files it
  // cannot run. Confirmed by running it once with no config. Vitest's globs
  // cover src/** and scripts/**, so with testDir set the two runners cannot
  // reach each other's specs.
  testDir: 'e2e',

  // Every spec launches its own browser with the extension loaded. Serial
  // keeps those launches from fighting over profile directories.
  workers: 1,
  fullyParallel: false,

  // This harness is invoked by hand, never by CI, so a retry would only hide a
  // flake from the person watching it happen.
  retries: 0,

  // The trace is the point: it replaces the manual chrome-devtools MCP loop
  // this ticket exists to make repeatable.
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
