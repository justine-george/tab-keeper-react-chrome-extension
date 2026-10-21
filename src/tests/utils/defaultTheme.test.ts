import { afterEach, describe, expect, it, vi } from 'vitest';

import { asTheme, defaultTheme, Theme } from '../../utils/constants/theme';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';

// KAN-731. A new install: Chalk, or Charcoal on a dark OS; a known stored theme stays.
// Node has no window: each test stands one up, as a browser or a worker has (or lacks) it.
const setOs = (dark: boolean) =>
  vi.stubGlobal('window', {
    matchMedia: (q: string) => new FakeMediaQueryList(q, dark),
  });
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('defaultTheme', () => {
  it('is Chalk on a light OS', () => {
    setOs(false);
    expect(defaultTheme()).toBe(Theme.CHALK);
  });

  it('is Charcoal on a dark OS', () => {
    setOs(true);
    expect(defaultTheme()).toBe(Theme.CHARCOAL);
  });

  it('asks for the dark scheme', () => {
    const seen: string[] = [];
    vi.stubGlobal('window', {
      matchMedia: (q: string) => {
        seen.push(q);
        return new FakeMediaQueryList(q, false);
      },
    });
    defaultTheme();
    expect(seen).toEqual(['(prefers-color-scheme: dark)']);
  });

  it('is Chalk where matchMedia is missing (a service worker)', () => {
    vi.stubGlobal('window', {});
    expect(defaultTheme()).toBe(Theme.CHALK);
  });

  it('is Chalk where there is no window (Node)', () => {
    expect(defaultTheme()).toBe(Theme.CHALK);
  });
});

describe('asTheme', () => {
  it.each(Object.values(Theme))('keeps a known theme (%s)', (theme) => {
    setOs(true);
    expect(asTheme(theme)).toBe(theme);
  });

  it.each([['Nonsense'], [3], [null], [undefined], ['__proto__']])(
    'reads %s as the default on both systems',
    (value) => {
      setOs(false);
      expect(asTheme(value)).toBe(Theme.CHALK);
      setOs(true);
      expect(asTheme(value)).toBe(Theme.CHARCOAL);
    }
  );
});

describe('the settings slice', () => {
  const fresh = async (dark: boolean, stored?: string) => {
    setOs(dark);
    if (stored !== undefined) localStorage.setItem('settingsData', stored);
    vi.resetModules();
    return (await import('../../redux/slices/settingsDataStateSlice'))
      .initialState.theme;
  };

  it.each([
    [false, Theme.CHALK],
    [true, Theme.CHARCOAL],
  ])('starts a new install on the default (dark OS %s)', async (dark, want) => {
    expect(await fresh(dark)).toBe(want);
  });

  it.each([[false], [true]])(
    'keeps a stored Paper (dark OS %s)',
    async (dark) => {
      expect(await fresh(dark, '{"theme":"Light"}')).toBe(Theme.LIGHT);
    }
  );

  it.each([
    [false, Theme.CHALK],
    [true, Theme.CHARCOAL],
  ])(
    'reads an unknown stored theme as the default (dark OS %s)',
    async (dark, want) => {
      expect(await fresh(dark, '{"theme":"Nonsense"}')).toBe(want);
    }
  );

  it('writes nothing at load', async () => {
    await fresh(true);
    expect(localStorage.getItem('settingsData')).toBeNull();
  });
});
