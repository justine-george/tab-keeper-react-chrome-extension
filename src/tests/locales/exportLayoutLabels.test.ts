import { describe, expect, test } from 'vitest';

import { initialState } from '../../redux/slices/settingsDataStateSlice';

// KAN-283 review. The export page's layout pair is Compact | Comfortable, and
// Compact is the default. Three translations named the OTHER option the
// default one -- de "Standard" and ja 標準 shipped, and ko 기본 ("default") was
// drafted from ja's -- so a reader was told the layout they were not on was
// the usual one. Listed words, as productName.test lists its
// transliterations: a scan can only find what it knows to look for.
const DEFAULT_WORDS = [
  'default',
  '標準', // ja, zh-TW
  '标准', // zh
  '기본', // ko
  '預設', // zh-TW
  '默认', // zh
  'デフォルト', // ja
  'estándar', // es
  'standard', // fr, de, sv
  'padrão', // pt
  'predefinit', // it
  'стандарт', // ru
  'मानक', // hi
];

const localeFiles = import.meta.glob('/public/locales/*/translation.json', {
  import: 'default',
  eager: true,
}) as Record<string, Record<string, string>>;

// KAN-287: de "Standard" and ja 標準 came in with KAN-190 (1.9.0) and get
// their own fix. Remove them when it lands; the test then covers both.
const KNOWN = new Set(['de', 'ja']);

describe('the non-default export layout is not labelled as the default', () => {
  test('CONTROL: Compact is the default this rule is about', () => {
    expect(initialState.exportLayout).toBe('compact');
  });

  test('no locale calls Comfortable the default or standard one', () => {
    const offenders = Object.entries(localeFiles)
      .map(([path, dict]) => [path.split('/')[3], dict['Comfortable']] as const)
      .filter(([lang]) => !KNOWN.has(lang))
      .filter(([, label]) =>
        DEFAULT_WORDS.some((w) => label.toLowerCase().includes(w))
      )
      .map(([lang, label]) => `${lang} -> ${label}`);

    expect(offenders).toEqual([]);
  });
});
