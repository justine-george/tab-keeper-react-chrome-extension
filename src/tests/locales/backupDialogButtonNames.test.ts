import { describe, expect, test } from 'vitest';

// KAN-967. The Load a backup dialog's Merge and Replace paragraphs open with
// the name of their button. Hindi's bare बदलें reads as an order ("replace!"),
// so Hindi quotes it, as its other sentences that open with a button do
// ("खोलें" …, "रिप्लेस" …). And a restore toast must not use the app's Undo
// word: zh-TW 復原 is Undo, a backup restore is 還原.
const localeFiles = import.meta.glob('/public/locales/*/translation.json', {
  import: 'default',
  eager: true,
}) as Record<string, Record<string, string>>;
const locales = Object.entries(localeFiles).map(
  ([path, dict]) => [path.split('/')[3], dict] as const
);
const hi = locales.find(([lang]) => lang === 'hi')![1];

// Every form of a key: ru splits the Other paragraphs into _one/_few/_many/_other.
const forms = (dict: Record<string, string>, key: string) =>
  Object.keys(dict).filter(
    (name) => name.replace(/_(one|few|many|other)$/, '') === key
  );

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
          .flatMap((key) => forms(dict, key))
          .filter((name) => !dict[name].includes(dict[button]))
          .map((name) => `${lang} ${name}`)
      )
    );
    expect(offenders).toEqual([]);
  });

  // CONTROL: every paragraph key exists in every locale (a missing key would
  // pass the label checks with nothing checked), and ru has its plural forms.
  test('every paragraph has text in every locale', () => {
    const missing = locales.flatMap(([lang, dict]) =>
      Object.values(PARAGRAPHS)
        .flat()
        .filter((key) => forms(dict, key).length === 0)
        .map((key) => `${lang} ${key}`)
    );
    expect(missing).toEqual([]);
    const ru = locales.find(([lang]) => lang === 'ru')![1];
    expect(forms(ru, 'MergeKeepsOther')).toHaveLength(4);
  });

  test('hi opens each paragraph with the label in quotes', () => {
    const offenders = Object.entries(PARAGRAPHS).flatMap(([button, keys]) =>
      keys
        .flatMap((key) => forms(hi, key))
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
        .filter(([, dict]) => dict[key].includes(dict['Undo']))
        .map(([lang, dict]) => `${lang} -> ${dict[key]}`);
      expect(offenders).toEqual([]);
    }
  );

  // CONTROL: zh-TW's Undo word is a substring a toast could plausibly carry,
  // so the check above can fail at all.
  test('zh-TW Undo is 復原', () => {
    const zhTW = locales.find(([lang]) => lang === 'zh-TW')![1];
    expect(zhTW['Undo']).toBe('復原');
  });
});
