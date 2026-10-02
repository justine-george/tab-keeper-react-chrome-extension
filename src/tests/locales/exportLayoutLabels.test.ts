import { describe, expect, test } from 'vitest';

import { initialState } from '../../redux/slices/settingsDataStateSlice';

// KAN-283. Comfortable is not the default, so no locale may call it so.
// A listed-word scan finds only what it knows to look for.
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

describe('the non-default export layout is not labelled as the default', () => {
  test('CONTROL: Compact is the default this rule is about', () => {
    expect(initialState.exportLayout).toBe('compact');
  });

  test('no locale calls Comfortable the default or standard one', () => {
    const offenders = Object.entries(localeFiles)
      .map(([path, dict]) => [path.split('/')[3], dict['Comfortable']] as const)
      .filter(([, label]) =>
        DEFAULT_WORDS.some((w) => label.toLowerCase().includes(w))
      )
      .map(([lang, label]) => `${lang} -> ${label}`);

    expect(offenders).toEqual([]);
  });
});
