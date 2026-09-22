import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// KAN-282. The language is decided in TWO places at load: i18n.tsx (what
// renders) and this slice's initial state (what is saved). Detecting in only
// the first would show German once and then lose it: the store would still
// hold `en`, and the first setting written -- the first-run consent answer,
// on the very first open -- persists the whole settings object, so the next
// open reads a saved `en` and stays English for good.
//
// The slice computes its initial state at module load, so each test sets
// Chrome's language and localStorage first and imports a fresh copy.

const g = globalThis as { chrome?: unknown };
const originalChrome = g.chrome;

const chromeSays = (tag: string) => {
  g.chrome = { i18n: { getUILanguage: () => tag } };
};

const freshSlice = async () => {
  vi.resetModules();
  return import('../../redux/slices/settingsDataStateSlice');
};

describe('the settings slice starts in the language the popup renders (KAN-282)', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    g.chrome = originalChrome;
  });

  it('a fresh profile starts in Chrome’s language', async () => {
    chromeSays('de-DE');
    const { initialState } = await freshSlice();
    expect(initialState.language).toBe('de');
  });

  // The trap. Any setting write persists the whole state; the language in it
  // must be the detected one, or the next open reverts to English.
  it('the first setting written saves the detected language, not English', async () => {
    chromeSays('ja');
    const { settingsDataStateSlice, initialState, grantCloudConsent } =
      await freshSlice();

    settingsDataStateSlice.reducer(initialState, grantCloudConsent());

    const saved = JSON.parse(localStorage.getItem('settingsData')!);
    expect(saved.language).toBe('ja');
  });

  // Existing users: every one of them has written a setting, so `language` is
  // saved. Chrome in German must not move an English user.
  it('a saved language wins over Chrome’s', async () => {
    localStorage.setItem('settingsData', JSON.stringify({ language: 'en' }));
    chromeSays('de-DE');
    const { initialState } = await freshSlice();
    expect(initialState.language).toBe('en');
  });

  it('an unshipped Chrome language starts in English', async () => {
    chromeSays('nl-NL');
    const { initialState } = await freshSlice();
    expect(initialState.language).toBe('en');
  });

  // The unit project has no chrome global at all; this is also the jsdom
  // component setup's state. Loading must not throw.
  it('no chrome API at all starts in English, without throwing', async () => {
    g.chrome = undefined;
    const { initialState } = await freshSlice();
    expect(initialState.language).toBe('en');
  });
});
