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

// Matches t('...'), t("..."), and t(`...`) -- backticked keys are common in
// the settings pane and review modal and are matched just like quoted ones.
// What this cannot see is a genuinely computed key: t(name) at
// SettingsCategoryContainer.tsx:78 passes a variable, not a literal, so no
// regex can recover the key from the source text. That call is therefore
// invisible to this scan and must be covered by other means (e.g. a render
// test). This test is a floor on coverage, not a complete census.
const KEY_PATTERN = /\bt\(\s*['"`]([^'"`]+)['"`]/g;

// The other nine translation files, by the same glob route as the sources
// above, so adding a locale directory needs no edit here.
const localeFiles = import.meta.glob('/public/locales/*/translation.json', {
  import: 'default',
  eager: true,
}) as Record<string, Record<string, string>>;

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

  // The test above only knows about `en`, so a key added to nine of the ten
  // files passes it. i18next then falls back to the en value and the ninth
  // language silently shows English -- no error, no failing render. Adding a
  // string is a ten-file edit and this is what says so.
  //
  // Symmetric on purpose: an EXTRA key in a translated file is reported too,
  // because it is either a typo (so the real key is missing and falls back) or
  // a leftover from a deleted string.
  test('every locale defines exactly the keys en defines', () => {
    const enKeys = new Set(Object.keys(en));
    const drift: string[] = [];

    for (const [path, json] of Object.entries(localeFiles)) {
      if (path.includes('/en/')) continue;
      const keys = new Set(Object.keys(json));

      for (const key of enKeys) {
        if (!keys.has(key)) drift.push(`${path}  missing  ${key}`);
      }
      for (const key of keys) {
        if (!enKeys.has(key)) drift.push(`${path}  extra    ${key}`);
      }
    }

    expect(drift).toEqual([]);
  });

  // i18next's nsSeparator is ':', so it reads `t('Matches:')` as namespace
  // "Matches" plus an empty key and answers with an empty string -- silently,
  // with the surrounding template literal still rendering its spaces. A colon
  // in the MIDDLE of a key is fine (the unreadable-token toast has one): the
  // prefix is not a loaded namespace, so lookup falls back to the whole key.
  // Only a trailing one bites.
  //
  // The en locale can never reveal this in a render test, because there the
  // key and the value are the same string -- "returned the key" and "found the
  // value" look identical. That is why this asserts on the key's SPELLING
  // rather than on anything rendered. KAN-60.
  test('no key ends in a colon, which i18next resolves to an empty string', () => {
    const offenders = Object.keys(en).filter((key) => key.endsWith(':'));

    expect(offenders).toEqual([]);
  });

  // The control for the test above. Without it, that test passes just as well
  // against a locale file that lost every key with punctuation in it.
  test('keys with a colon elsewhere, and with dots, are still present', () => {
    const punctuated = Object.keys(en).filter(
      (key) => key.includes(':') || key.includes('.')
    );

    expect(punctuated.length).toBeGreaterThan(0);
  });
});
