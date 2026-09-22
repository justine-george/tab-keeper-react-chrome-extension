import { describe, expect, test } from 'vitest';

import manifest from '../../../public/manifest.json';

// KAN-274. The store name, summary and toolbar title come from the manifest,
// and until now were English literals, so every market saw an English listing.
// Chrome's own extension i18n replaces them with `__MSG_key__` placeholders
// resolved from public/_locales/<locale>/messages.json.
//
// The failure this file exists for is not cosmetic: Chrome REFUSES TO LOAD an
// extension whose manifest names a message the default locale lacks, or whose
// messages.json does not parse. Nothing in the popup would show it; the
// extension would simply fail to install. So the placeholders are resolved
// here, against the files, the way Chrome will.
//
// Read through import.meta.glob, not node:fs, for the reason keyCoverage.test
// gives: tsconfig carries no Node types on purpose.

type Messages = Record<string, { message: string; description?: string }>;

const files = import.meta.glob('/public/_locales/*/messages.json', {
  import: 'default',
  eager: true,
}) as Record<string, Messages>;

// '/public/_locales/en/messages.json' -> 'en'
const byLocale = new Map(
  Object.entries(files).map(([path, messages]) => [
    path.split('/')[3],
    messages,
  ])
);
const LOCALES = [...byLocale.keys()];
const readMessages = (locale: string): Messages => byLocale.get(locale) ?? {};

// Every string anywhere in the manifest, so a placeholder added later in a
// field this file does not name is still checked.
const allStrings = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(allStrings)
      : value && typeof value === 'object'
        ? Object.values(value).flatMap(allStrings)
        : [];

const PLACEHOLDER = /__MSG_(\w+)__/g;

// The locale codes Chrome accepts as _locales folder names. Bare `pt` and `zh`
// are NOT among them -- the app's `pt` and `zh` map to pt_BR and zh_CN here.
const CHROME_LOCALES = new Set([
  'ar',
  'am',
  'bg',
  'bn',
  'ca',
  'cs',
  'da',
  'de',
  'el',
  'en',
  'en_AU',
  'en_GB',
  'en_US',
  'es',
  'es_419',
  'et',
  'fa',
  'fi',
  'fil',
  'fr',
  'gu',
  'he',
  'hi',
  'hr',
  'hu',
  'id',
  'it',
  'ja',
  'kn',
  'ko',
  'lt',
  'lv',
  'ml',
  'mr',
  'ms',
  'nl',
  'no',
  'pl',
  'pt_BR',
  'pt_PT',
  'ro',
  'ru',
  'sk',
  'sl',
  'sr',
  'sv',
  'sw',
  'ta',
  'te',
  'th',
  'tr',
  'uk',
  'vi',
  'zh_CN',
  'zh_TW',
]);

describe('the manifest takes its listing text from _locales (KAN-274)', () => {
  test('names English as the default locale', () => {
    expect(manifest.default_locale).toBe('en');
  });

  test('name, summary and toolbar title are placeholders, not literals', () => {
    expect(manifest.name).toBe('__MSG_appName__');
    expect(manifest.description).toBe('__MSG_appDesc__');
    expect(manifest.action.default_title).toBe('__MSG_appName__');
  });

  // The load-failure guard. Delete a key from en/messages.json and this is
  // the test that goes red, before Chrome refuses the package.
  test('every placeholder the manifest uses exists in the default locale', () => {
    const used = new Set(
      allStrings(manifest).flatMap((s) =>
        [...s.matchAll(PLACEHOLDER)].map((m) => m[1])
      )
    );
    expect(used.size).toBeGreaterThan(0);
    const en = readMessages(manifest.default_locale!);
    for (const key of used) {
      expect(en, `missing in _locales/en: ${key}`).toHaveProperty(key);
    }
  });
});

describe('every _locales file', () => {
  test('there is at least the default locale', () => {
    expect(LOCALES).toContain('en');
  });

  test.each(LOCALES)('%s is a folder name Chrome accepts', (locale) => {
    expect(CHROME_LOCALES.has(locale), locale).toBe(true);
  });

  test.each(LOCALES)('%s parses, and every message is non-empty', (locale) => {
    const messages = readMessages(locale);
    for (const [key, { message }] of Object.entries(messages)) {
      expect(typeof message, `${locale}.${key}`).toBe('string');
      expect(message.trim(), `${locale}.${key}`).not.toBe('');
    }
  });

  // The Web Store's limits, counted in characters: a CJK summary is short in
  // characters and long in bytes, and characters are what the store counts.
  test.each(LOCALES)(
    '%s: the name fits 75 and keeps the brand first',
    (locale) => {
      const { appName } = readMessages(locale);
      if (!appName) return; // a locale may translate only some keys
      expect([...appName.message].length).toBeLessThanOrEqual(75);
      expect(appName.message.startsWith('Tab Keeper')).toBe(true);
    }
  );

  test.each(LOCALES)('%s: the summary fits 132', (locale) => {
    const { appDesc } = readMessages(locale);
    if (!appDesc) return;
    expect([...appDesc.message].length).toBeLessThanOrEqual(132);
  });
});
