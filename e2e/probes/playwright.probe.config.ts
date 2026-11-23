import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineConfig } from '@playwright/test';

// KAN-983. Runs e2e/probes/*.probe.ts, which fail on purpose; the main config never matches them.
export default defineConfig({
  testDir: '.',
  testMatch: '*.probe.ts',
  workers: 1,
  retries: 0,
  reporter: 'line',
  outputDir: join(tmpdir(), 'tabkeeper-e2e-probe-results'),
});
