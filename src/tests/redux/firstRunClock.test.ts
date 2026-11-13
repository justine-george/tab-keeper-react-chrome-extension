import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Language } from '../../utils/functions/languages';

// KAN-954. A first run starts on its language's usual clock; anything already saved keeps its own.

const g = globalThis as { chrome?: unknown };
const originalChrome = g.chrome;

const chromeSays = (tag: string) => {
  g.chrome = { i18n: { getUILanguage: () => tag } };
};

const freshSlice = async () => {
  vi.resetModules();
  return import('../../redux/slices/settingsDataStateSlice');
};

beforeEach(() => localStorage.clear());
afterEach(() => {
  g.chrome = originalChrome;
  localStorage.clear();
});

describe('the usual clock per language', () => {
  it('matches what Intl draws for every shipped language', async () => {
    const { USUAL_CLOCK } = await freshSlice();
    for (const lang of Object.values(Language)) {
      // 3 PM: a 24-hour language draws the hour as 15.
      const hour = new Intl.DateTimeFormat(lang, { hour: 'numeric' })
        .formatToParts(new Date(2026, 0, 1, 15))
        .find((p) => p.type === 'hour')?.value;
      const intl = hour === '15' ? 'h23' : 'h12';
      expect([lang, USUAL_CLOCK[lang]]).toEqual([lang, intl]);
    }
  });
});

describe('a first run', () => {
  it.each([
    ['de-DE', 'h23'],
    ['fr', 'h23'],
    ['ja', 'h23'],
    ['zh-CN', 'h23'],
    ['en-US', 'h12'],
    ['ko', 'h12'],
    ['zh-TW', 'h12'],
    ['hi', 'h12'],
  ])('in %s starts on %s', async (tag, clock) => {
    chromeSays(tag);
    const { initialState } = await freshSlice();
    expect(initialState.timeFormat).toBe(clock);
  });

  it('in an unshipped language starts in English, on 12-hour', async () => {
    chromeSays('nl-NL');
    const { initialState } = await freshSlice();
    expect(initialState).toMatchObject({ language: 'en', timeFormat: 'h12' });
  });

  it('unreadable saved settings count as a first run', async () => {
    localStorage.setItem('settingsData', '{not json');
    chromeSays('de');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { initialState } = await freshSlice();
    expect(initialState.timeFormat).toBe('h23');
  });

  // The first setting written persists the whole state, so the clock must be in it.
  it('the first setting written saves the clock', async () => {
    chromeSays('sv');
    const { settingsDataStateSlice, initialState, grantCloudConsent } =
      await freshSlice();

    settingsDataStateSlice.reducer(initialState, grantCloudConsent());

    expect(JSON.parse(localStorage.getItem('settingsData')!)).toMatchObject({
      language: 'sv',
      timeFormat: 'h23',
    });
  });

  it('a later language change leaves the clock alone', async () => {
    chromeSays('de');
    const { settingsDataStateSlice, initialState, setLanguage } =
      await freshSlice();

    const after = settingsDataStateSlice.reducer(
      initialState,
      setLanguage(Language.EN)
    );

    expect(after).toMatchObject({ language: 'en', timeFormat: 'h23' });
  });
});

describe('an existing user', () => {
  it('saved before the setting existed keeps 12-hour, in any language', async () => {
    localStorage.setItem('settingsData', JSON.stringify({ language: 'de' }));
    chromeSays('de');
    const { initialState } = await freshSlice();
    expect(initialState.timeFormat).toBe('h12');
  });

  it('with an empty saved object keeps 12-hour', async () => {
    localStorage.setItem('settingsData', '{}');
    chromeSays('de');
    const { initialState } = await freshSlice();
    expect(initialState.timeFormat).toBe('h12');
  });

  it('keeps a saved 12-hour over a 24-hour language', async () => {
    localStorage.setItem('settingsData', JSON.stringify({ timeFormat: 'h12' }));
    chromeSays('de');
    const { initialState } = await freshSlice();
    expect(initialState.timeFormat).toBe('h12');
  });

  it('keeps a saved 24-hour over a 12-hour language', async () => {
    localStorage.setItem('settingsData', JSON.stringify({ timeFormat: 'h23' }));
    chromeSays('en-US');
    const { initialState } = await freshSlice();
    expect(initialState.timeFormat).toBe('h23');
  });
});
