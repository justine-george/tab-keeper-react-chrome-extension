import { describe, expect, test, vi } from 'vitest';

// A fresh module per test: the memo lives in it, for the file's whole life.
const freshModule = async () => {
  vi.resetModules();
  return import('./i18nForTests');
};

describe('initTestI18n', () => {
  test('inits the instance once, however many times it is called', async () => {
    const { initTestI18n, testI18n } = await freshModule();
    const init = vi.spyOn(testI18n, 'init');

    await initTestI18n();
    await initTestI18n();

    expect(init).toHaveBeenCalledTimes(1);
  });

  test('every call still puts the language back on en', async () => {
    const { initTestI18n, testI18n } = await freshModule();
    await initTestI18n();
    await testI18n.changeLanguage('de');

    await initTestI18n();

    expect(testI18n.language).toBe('en');
  });

  test('translates once awaited', async () => {
    const { initTestI18n, testI18n } = await freshModule();

    await initTestI18n();

    expect(testI18n.t('Turn on')).toBe('Turn on');
    expect(testI18n.isInitialized).toBe(true);
  });
});
