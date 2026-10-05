import { afterEach, describe, expect, test } from 'vitest';

import {
  LANGUAGE_OPTIONS,
  chromeLanguageFirst,
  chromeLanguageOrder,
} from '../../components/settings/rightpane/languageOptions';
import { Language } from '../../redux/slices/settingsDataStateSlice';

// KAN-420. Chrome's language first; the other twelve keep picker order.

const chromeCodes = (chrome: Language | undefined) =>
  chromeLanguageFirst(chrome).map(([code]) => code);
const pickerCodes = LANGUAGE_OPTIONS.map(([code]) => code);

describe('chromeLanguageFirst', () => {
  test('Chrome in French puts French first and keeps the other twelve in picker order', () => {
    expect(chromeCodes(Language.FR)).toEqual([
      'fr',
      ...pickerCodes.filter((c) => c !== 'fr'),
    ]);
  });

  test('Chrome in English puts English first', () => {
    expect(chromeCodes(Language.EN)).toEqual([
      'en',
      ...pickerCodes.filter((c) => c !== 'en'),
    ]);
  });

  test('Chrome in Traditional Chinese puts it first, ahead of Simplified', () => {
    expect(chromeCodes(Language.ZH_TW).slice(0, 2)).toEqual(['zh-TW', 'de']);
  });

  test('a Chrome language that cannot be read leaves the picker order exactly', () => {
    expect(chromeCodes(undefined)).toEqual(pickerCodes);
  });

  test.each(Object.values(Language))('%s: all thirteen, once each', (c) => {
    expect(new Set(chromeCodes(c)).size).toBe(13);
  });
});

describe('chromeLanguageOrder reads Chrome’s tag', () => {
  const g = globalThis as { chrome?: unknown };
  const original = g.chrome;
  afterEach(() => {
    g.chrome = original;
  });
  const orderFor = (tag: string) => {
    g.chrome = { i18n: { getUILanguage: () => tag } };
    return chromeLanguageOrder().map(([code]) => code);
  };

  test.each(['zh-Hant-TW', 'zh-HK'])(
    '%s puts Traditional Chinese first',
    (tag) => {
      expect(orderFor(tag)).toEqual([
        'zh-TW',
        ...pickerCodes.filter((c) => c !== 'zh-TW'),
      ]);
    }
  );

  test('a tag this build does not ship leaves the picker order exactly', () => {
    expect(orderFor('pl-PL')).toEqual(pickerCodes);
  });
});
