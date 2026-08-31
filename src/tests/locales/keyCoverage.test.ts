import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import en from '../../../public/locales/en/translation.json';

// i18next falls back to returning the key when one is missing, and 72 of the
// 91 en values are identical to their keys -- so a deleted key renders the
// same string and fails no render test. This is the only check that sees it.
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx?$/.test(path) ? [path] : [];
  });

// Matches t('...') and t("..."). Template literals and computed keys are not
// matched and would be missed; there are none today, and adding one should be
// a deliberate decision rather than a silent gap.
const KEY_PATTERN = /\bt\(\s*['"]([^'"]+)['"]/g;

describe('translation key coverage', () => {
  test('every t() key used in src exists in the en locale', () => {
    const missing: string[] = [];

    for (const file of walk('src')) {
      if (file.includes(`${'src'}/tests/`)) continue;
      const source = readFileSync(file, 'utf8');
      for (const [, key] of source.matchAll(KEY_PATTERN)) {
        if (!(key in en)) missing.push(`${key}  (${file})`);
      }
    }

    expect(missing).toEqual([]);
  });
});
