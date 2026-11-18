import { describe, expect, test } from 'vitest';

import { SHIPPED_LANGUAGES } from '../../utils/functions/languages';

// KAN-967. The Load a backup dialog's Merge and Replace paragraphs open with
// the name of their button. Hindi's bare बदलें reads as an order ("replace!"),
// so Hindi quotes it, as its other sentences that open with a button do
// ("खोलें" …, "रिप्लेस" …). And a restore toast must not use the app's Undo
// word: zh-TW 復原 is Undo, a backup restore is 還原.
//
// Each check below throws on a missing language or key rather than passing
// with nothing checked.
const localeFiles = import.meta.glob('/public/locales/*/translation.json', {
  import: 'default',
  eager: true,
}) as Record<string, Record<string, string>>;

const dictFor = (lang: string): Record<string, string> => {
  const dict = localeFiles[`/public/locales/${lang}/translation.json`];
  if (!dict) throw new Error(`no translation file for ${lang}`);
  return dict;
};
const locales = SHIPPED_LANGUAGES.map((lang) => [lang, dictFor(lang)] as const);

// Every form of a key: ru splits the Other paragraphs into _one/_few/_many/_other.
const forms = (lang: string, dict: Record<string, string>, key: string) => {
  const names = Object.keys(dict).filter(
    (name) => name.replace(/_(one|few|many|other)$/, '') === key
  );
  if (names.length === 0) throw new Error(`${lang} has no ${key}`);
  return names;
};

const PARAGRAPHS = {
  LoadBackupReplace: [
    'ReplaceDeletesOne',
    'ReplaceDeletesOther',
    'ReplaceDeletesOneWithSettings',
    'ReplaceDeletesOtherWithSettings',
  ],
  LoadBackupMerge: ['MergeKeepsOne', 'MergeKeepsOther'],
};

describe('the backup dialog paragraphs name their button', () => {
  test('in every locale, each paragraph contains its button label', () => {
    const offenders = locales.flatMap(([lang, dict]) =>
      Object.entries(PARAGRAPHS).flatMap(([button, keys]) =>
        keys
          .flatMap((key) => forms(lang, dict, key))
          .filter((name) => !dict[name].includes(dict[button]))
          .map((name) => `${lang} ${name}`)
      )
    );
    expect(offenders).toEqual([]);
  });

  test('hi opens each paragraph with the label in quotes', () => {
    const hi = dictFor('hi');
    const offenders = Object.entries(PARAGRAPHS).flatMap(([button, keys]) =>
      keys
        .flatMap((key) => forms('hi', hi, key))
        .filter((name) => !hi[name].startsWith(`"${hi[button]}" `))
    );
    expect(offenders).toEqual([]);
  });
});

describe('restore toasts do not use the Undo word', () => {
  test.each(['Tabs restored.', 'Sessions and settings restored.'])(
    '%s',
    (key) => {
      const offenders = locales
        .filter(([lang, dict]) => {
          if (!dict[key] || !dict['Undo'])
            throw new Error(`${lang} lacks ${key} or Undo`);
          return dict[key].includes(dict['Undo']);
        })
        .map(([lang, dict]) => `${lang} -> ${dict[key]}`);
      expect(offenders).toEqual([]);
    }
  );
});
