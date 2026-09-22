import { describe, expect, test } from 'vitest';

import { Language } from '../../redux/slices/settingsDataStateSlice';

// KAN-283. A Language value does three jobs at once: it is the folder the
// HTTP backend fetches (/locales/{{lng}}/translation.json), the tag handed to
// Intl.DateTimeFormat / Intl.Collator / toLocaleDateString, and the value
// persisted in settingsData. So it has to be a real BCP 47 tag AND a real
// folder, and the two lists cannot drift apart.
//
// Read through import.meta.glob for the reason keyCoverage.test.ts sets out:
// tsconfig's `types` array is deliberately without "node".
const localeFiles = import.meta.glob('/public/locales/*/translation.json', {
  import: 'default',
  eager: true,
}) as Record<string, Record<string, string>>;

const folders = Object.keys(localeFiles)
  .map((path) => path.split('/')[3])
  .sort();

const languages: string[] = Object.values(Language).sort();

describe('supported languages (KAN-283)', () => {
  test('ships Swedish, Korean and Traditional Chinese', () => {
    expect(languages).toEqual(expect.arrayContaining(['sv', 'ko', 'zh-TW']));
  });

  // A Language with no folder fetches a 404 and the whole UI falls back to
  // English with no error; a folder with no Language can never be picked.
  test('every language has a translation file, and every file is a language', () => {
    expect(folders).toEqual(languages);
  });

  // The Chrome manifest spells Traditional Chinese zh_TW, and that spelling is
  // one keystroke away here. Intl rejects it with a RangeError, and
  // Intl.Collator runs inside the sort reducer, so a user who picked it could
  // not sort. Canonical form also matters: 'zh-tw' would be accepted by Intl
  // but is not the folder name.
  test('every language is a canonical BCP 47 tag that Intl accepts', () => {
    for (const lang of languages) {
      expect(new Intl.Locale(lang).toString()).toBe(lang);
      expect(() => new Intl.Collator(lang)).not.toThrow();
    }
  });

  // CONTROL for the test above: it can fail. Without this, a test that never
  // reaches Intl (say, an empty list) passes the same way.
  test('the Chrome manifest spelling is rejected, so the check above can fail', () => {
    expect(languages.length).toBeGreaterThan(0);
    expect(() => new Intl.Locale('zh_TW')).toThrow(RangeError);
  });
});
