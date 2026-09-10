import { defineConfig } from '@playwright/test';

export default defineConfig({
  // Load-bearing, not tidiness. Playwright's default testDir is the repo root
  // and its default match includes .mjs, so without this it collects
  // scripts/prune_remote_code.test.mjs and src/**/*.test.ts -- vitest files it
  // cannot run. Confirmed by running it once with no config. Vitest's globs
  // cover src/** and scripts/**, so with testDir set the two runners cannot
  // reach each other's specs.
  testDir: 'e2e',

  // A hang must fail the job, not sit on it. Without this a fixture that never
  // resolves burns the runner's whole budget: the first CI attempt at KAN-146
  // sat in `Run E2E tests` for 13m51s printing nothing, which is 64 tests each
  // waiting out the default 30s timeout one at a time.
  globalTimeout: 12 * 60_000,

  // `list`, explicitly. Playwright defaults to `dot` when CI is set, and dot
  // writes no newline per test -- so a stuck run and a progressing one look
  // identical in a GitHub Actions log. That is exactly how the 13m51s hang
  // read as "still running".
  reporter: 'list',

  // Every spec launches its own browser with the extension loaded. Serial
  // keeps those launches from fighting over profile directories.
  workers: 1,
  fullyParallel: false,

  // Still zero now that CI runs this (KAN-146), and deliberately so. A retry
  // turns a flake into a pass, and this repo has just paid for what a hidden
  // flake costs: KAN-145 was a fixture racing the clock, green on every local
  // run, red on a slower runner, and the only reason it was ever diagnosed is
  // that it failed loudly. Green-on-retry would have buried it.
  retries: 0,

  // The trace is the point: it replaces the manual chrome-devtools MCP loop
  // this ticket exists to make repeatable.
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
