import { describe, expect, test } from 'vitest';

import { languageOrderFor } from '../../components/settings/rightpane/languageOptions';
import { Language } from '../../redux/slices/settingsDataStateSlice';

// KAN-7 §5. The current language first; the other twelve keep picker order.

const codes = (current: Language) =>
  languageOrderFor(current).map(([code]) => code);

describe('languageOrderFor', () => {
  test('English moves first from second', () => {
    expect(codes(Language.EN)).toEqual([
      'en',
      'de',
      'es',
      'fr',
      'it',
      'pt',
      'sv',
      'ru',
      'hi',
      'ko',
      'ja',
      'zh',
      'zh-TW',
    ]);
  });

  test('Japanese moves first; the rest keep their order', () => {
    expect(codes(Language.JA)).toEqual([
      'ja',
      'de',
      'en',
      'es',
      'fr',
      'it',
      'pt',
      'sv',
      'ru',
      'hi',
      'ko',
      'zh',
      'zh-TW',
    ]);
  });

  test.each(Object.values(Language))(
    '%s: all thirteen, once each',
    (current) => {
      expect(new Set(codes(current)).size).toBe(13);
    }
  );
});
