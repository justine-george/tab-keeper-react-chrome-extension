import { describe, expect, test } from 'vitest';

import de from '../../../public/locales/de/translation.json';
import en from '../../../public/locales/en/translation.json';
import es from '../../../public/locales/es/translation.json';
import fr from '../../../public/locales/fr/translation.json';
import hi from '../../../public/locales/hi/translation.json';
import it from '../../../public/locales/it/translation.json';
import ja from '../../../public/locales/ja/translation.json';
import pt from '../../../public/locales/pt/translation.json';
import ru from '../../../public/locales/ru/translation.json';
import zh from '../../../public/locales/zh/translation.json';

// KAN-60 puts one new word on screen, and i18next answers a missing key by
// returning the key itself -- so a locale that never got the translation still
// renders the English "Matches:" with no error anywhere. Only a test that
// reads the VALUES sees it. Same reasoning as verbSplit.test.ts: the key is an
// English source string, and what a user reads is whatever the locale maps it
// to.
const LOCALES: Record<string, Record<string, string>> = {
  de,
  en,
  es,
  fr,
  hi,
  it,
  ja,
  pt,
  ru,
  zh,
};

// The KEY has no colon; the VALUES all end in one. i18next reads a trailing
// ':' as its namespace separator, so a key spelled 'Matches:' resolves to an
// empty string -- see the trailing-colon test in keyCoverage.test.ts.
const KEY = 'Matches';

describe('the search-match prefix is translated everywhere', () => {
  test('every locale defines it', () => {
    const missing = Object.entries(LOCALES)
      .filter(([, strings]) => !strings[KEY])
      .map(([lang]) => lang);

    expect(missing).toEqual([]);
  });

  // The control. Without it the test above passes with ten copies of the
  // English word pasted into ten files -- which is exactly what "the key is
  // returned when the translation is missing" looks like from the outside.
  test('no locale but en leaves it as the English source string', () => {
    const englishValue = en[KEY as keyof typeof en] as string;
    const untranslated = Object.entries(LOCALES)
      .filter(
        ([lang, strings]) => lang !== 'en' && strings[KEY] === englishValue
      )
      .map(([lang]) => lang);

    expect(untranslated).toEqual([]);
  });

  // It is a prefix, so it carries its own punctuation: French wants a space
  // before the colon and ja/zh want the fullwidth form. Hardcoding ":" in the
  // component would impose the English convention on all ten.
  test('every locale carries its own colon rather than borrowing one from code', () => {
    const noColon = Object.entries(LOCALES)
      .filter(([, strings]) => !/[:：]$/.test(strings[KEY] ?? ''))
      .map(([lang, strings]) => `${lang} -> ${strings[KEY]}`);

    expect(noColon).toEqual([]);
  });
});
