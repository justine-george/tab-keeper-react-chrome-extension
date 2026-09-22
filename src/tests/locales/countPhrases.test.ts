import { describe, expect, test } from 'vitest';

import en from '../../../public/locales/en/translation.json';
import { formatGroupCounts } from '../../utils/functions/local';
import { localeDicts, tFor } from '../setup/localeT';

// KAN-286. Counts were assembled in code as `${count} ${count > 1 ? plural :
// singular}` -- the English rule, in English word order. Russian has three
// plural forms, so a session of five tabs read "5 Вкладки" where Russian says
// "5 вкладок"; Chinese and Japanese could not add the counter word a count
// needs. Each locale now owns the whole phrase, as i18next plural keys.
//
// Resolved through a real i18next instance, because the plural choice IS the
// behaviour under test: a hand-rolled lookup would test the lookup.
const locales = localeDicts;

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

// The bases en declares as plural, e.g. "TabCount" from TabCount_one/_other.
const pluralBases = [
  ...new Set(
    Object.keys(en)
      .filter((key) => PLURAL_SUFFIX.test(key))
      .map((key) => key.replace(PLURAL_SUFFIX, ''))
  ),
];

describe('counts are whole phrases, plural-correct in every locale (KAN-286)', () => {
  test('en reads exactly as before', async () => {
    const t = await tFor('en');
    expect(formatGroupCounts(7, 13, false, t)).toBe('7 Windows · 13 Tabs');
    expect(formatGroupCounts(1, 1, true, t)).toBe('Matches: 1 Window · 1 Tab');
  });

  // The one intended change in English: `count > 1` sent zero to the
  // singular. English plural rules put it in "other".
  test('en zero is plural', async () => {
    const t = await tFor('en');
    expect(formatGroupCounts(0, 0, false, t)).toBe('0 Windows · 0 Tabs');
  });

  test('ru uses its three forms: 21 is one, 2 is few, 5 is many', async () => {
    const t = await tFor('ru');
    expect(formatGroupCounts(21, 21, false, t)).toBe('21 окно · 21 вкладка');
    expect(formatGroupCounts(2, 2, false, t)).toBe('2 окна · 2 вкладки');
    expect(formatGroupCounts(5, 5, false, t)).toBe('5 окон · 5 вкладок');
  });

  test('zh counts with its measure word', async () => {
    const t = await tFor('zh');
    expect(formatGroupCounts(3, 5, false, t)).toBe('3 个窗口 · 5 个标签页');
  });

  // A locale file missing one of its language's categories does not fail
  // loudly: i18next falls back to English, so ru without _many printed
  // "5 Tabs". Measured, not assumed. Hence exactly the categories
  // Intl.PluralRules names for that language -- no more, no fewer.
  test('every locale defines exactly its own plural categories', () => {
    const drift: string[] = [];
    for (const [lang, dict] of locales) {
      const wanted = new Intl.PluralRules(lang)
        .resolvedOptions()
        .pluralCategories.slice()
        .sort();
      for (const base of pluralBases) {
        const have = Object.keys(dict)
          .filter((key) => key.replace(PLURAL_SUFFIX, '') === base)
          .filter((key) => PLURAL_SUFFIX.test(key))
          .map((key) => key.match(PLURAL_SUFFIX)![1])
          .sort();
        if (have.join() !== wanted.join())
          drift.push(`${lang} ${base}: has [${have}] needs [${wanted}]`);
      }
    }
    expect(drift).toEqual([]);
  });

  // CONTROL for the test above: it has plural keys to check, so an empty
  // drift list is a result rather than an empty loop.
  test('CONTROL: en declares the window and tab counts as plural', () => {
    expect(pluralBases).toEqual(
      expect.arrayContaining(['WindowCount', 'TabCount'])
    );
  });
});
