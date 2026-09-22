import i18next from 'i18next';
import { describe, expect, test } from 'vitest';

import { mirrorLanguageOnDocument } from '../../utils/functions/documentLanguage';

// KAN-283. Chrome picks the glyph variant of a Han character from the lang
// attribute, not from the text. With index.html and export.html both fixed at
// lang="en", a Traditional Chinese or Japanese UI was drawn in the Simplified
// forms: measured in Chromium, 骨直誤角 renders pixel-identical under "en" and
// "zh-CN", and differently under "zh-TW" and "ja".
//
// A fresh instance per test with inline resources, so nothing is fetched and
// no test inherits another's language.
const makeI18n = async (lng: string) => {
  const instance = i18next.createInstance();
  await instance.init({
    lng,
    fallbackLng: 'en',
    resources: {
      en: { translation: {} },
      'zh-TW': { translation: {} },
      ja: { translation: {} },
    },
  });
  return instance;
};

describe('the document lang follows the UI language (KAN-283)', () => {
  test('is set from the language already chosen', async () => {
    const root = { lang: 'en' };

    mirrorLanguageOnDocument(await makeI18n('zh-TW'), root);

    expect(root.lang).toBe('zh-TW');
  });

  test('follows a later change of language', async () => {
    const root = { lang: '' };
    const instance = await makeI18n('en');
    mirrorLanguageOnDocument(instance, root);
    expect(root.lang).toBe('en');

    await instance.changeLanguage('ja');

    expect(root.lang).toBe('ja');
  });

  // Registered before init() in the app, where the first language arrives
  // only after the HTTP backend loads. The listener has to catch that too.
  test('picks up the language when it is mirrored before init', async () => {
    const root = { lang: 'en' };
    const instance = i18next.createInstance();

    mirrorLanguageOnDocument(instance, root);
    await instance.init({
      lng: 'zh-TW',
      resources: { 'zh-TW': { translation: {} } },
    });

    expect(root.lang).toBe('zh-TW');
  });
});
