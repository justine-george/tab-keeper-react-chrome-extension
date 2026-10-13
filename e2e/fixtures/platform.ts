import type { BrowserContext } from '@playwright/test';

// What runtime.getPlatformInfo() reports in every page, whatever machine runs the test.
// Overridden before the app reads it, as first-run-language.spec.ts does for the UI language.
export const platformSays = (context: BrowserContext, os: 'mac' | 'win') =>
  context.addInitScript((platformOs: 'mac' | 'win') => {
    const runtime = globalThis.chrome?.runtime;
    if (runtime) {
      Object.defineProperty(runtime, 'getPlatformInfo', {
        value: async () => ({ os: platformOs, arch: 'x86-64' }),
        configurable: true,
      });
    }
  }, os);
