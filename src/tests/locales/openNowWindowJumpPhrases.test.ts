import { describe, expect, test } from 'vitest';

import { localeDicts } from '../setup/localeT';

// KAN-331 O15b N2/H2. i18next answers a missing key with the key itself, so
// an untranslated locale still renders English with no error; only reading
// the values sees it.
const EXPECTED: Record<string, string> = {
  de: 'Zum Fenster wechseln',
  en: 'Go to window',
  es: 'Ir a la ventana',
  fr: 'Aller à la fenêtre',
  hi: 'विंडो पर जाएं',
  it: 'Vai alla finestra',
  ja: 'ウィンドウに移動',
  ko: '창으로 이동',
  pt: 'Ir para a janela',
  ru: 'Перейти к окну',
  sv: 'Gå till fönstret',
  zh: '转到窗口',
  'zh-TW': '前往視窗',
};

describe('"Go to window" (KAN-331)', () => {
  test('every locale has its phrase', () => {
    const got = Object.fromEntries(
      localeDicts.map(([lang, dict]) => [lang, dict['Go to window']])
    );
    expect(got).toEqual(EXPECTED);
  });
});
