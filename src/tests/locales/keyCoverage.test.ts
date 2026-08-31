import { describe, expect, test } from 'vitest';

import en from '../../../public/locales/en/translation.json';

// i18next falls back to returning the key when one is missing, and 72 of the
// 91 en values are identical to their keys -- so a deleted key renders the
// same string and fails no render test. This is the only check that sees it.
//
// Reads the source tree via Vite's import.meta.glob rather than node:fs:
// tsconfig.json's `types` array is explicit (no "node"), so node:fs/node:path
// have no ambient module declarations here and fail tsc even though vitest
// resolves them fine at runtime. Adding "node" to fix that would be a
// project-wide change that makes ordinary extension source -- which never
// runs in Node -- type-check clean against Node globals like `process` and
// `Buffer`, silently removing a real compiler guard (see KAN-36, where
// window.screen at module load crashed the MV3 service worker: the class of
// bug an environment-mismatched global produces). import.meta.glob needs no
// such change.
const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Matches t('...') and t("..."). Template literals and computed keys are not
// matched and would be missed; there are none today, and adding one should be
// a deliberate decision rather than a silent gap.
const KEY_PATTERN = /\bt\(\s*['"]([^'"]+)['"]/g;

describe('translation key coverage', () => {
  test('every t() key used in src exists in the en locale', () => {
    const missing: string[] = [];

    for (const [file, source] of Object.entries(sources)) {
      if (file.includes('/src/tests/')) continue;
      for (const [, key] of source.matchAll(KEY_PATTERN)) {
        if (!(key in en)) missing.push(`${key}  (${file})`);
      }
    }

    expect(missing).toEqual([]);
  });
});
