import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { FakeMediaQueryList } from '../setup/mediaQueryFake';

import {
  BB_PINK_THEME,
  BLUE_THEME,
  CHALK_THEME,
  CHARCOAL_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
} from '../../hooks/useThemeColors';
import type { ThemeColors } from '../../hooks/useThemeColors';
import { Theme } from '../../redux/slices/settingsDataStateSlice';

// public/theme-ground.js paints the stored theme's ground before React; its table must follow the palettes.
const source = Object.values(
  import.meta.glob<string>('/public/theme-ground.js', {
    query: '?raw',
    import: 'default',
    eager: true,
  })
)[0];

function groundFor(storage: Pick<Storage, 'getItem'>): string | undefined {
  const set: Record<string, string> = {};
  const documentStub = {
    documentElement: {
      style: { setProperty: (k: string, v: string) => (set[k] = v) },
    },
  };
  new Function('document', 'localStorage', source)(documentStub, storage);
  return set['--app-background'];
}

const stored = (value: string | null) => ({ getItem: () => value });

// As useThemeColors maps them; a theme added to Theme without a palette here fails.
const PALETTES: Record<Theme, ThemeColors> = {
  [Theme.LIGHT]: LIGHT_THEME,
  [Theme.WARM_LIGHT]: WARM_LIGHT_THEME,
  [Theme.BB_PINK]: BB_PINK_THEME,
  [Theme.DARKENHEIMER]: DARKENHEIMER_THEME,
  [Theme.BLUE]: BLUE_THEME,
  [Theme.CHALK]: CHALK_THEME,
  [Theme.CHARCOAL]: CHARCOAL_THEME,
};

describe('theme-ground.js', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('exists', () => {
    expect(source).toContain('--app-background');
  });

  test.each(Object.values(Theme))('%s paints its PRIMARY_COLOR', (theme) => {
    const settings = { theme, isChalkCharcoalMoveApplied: true };
    expect(groundFor(stored(JSON.stringify(settings)))).toBe(
      PALETTES[theme].PRIMARY_COLOR
    );
  });

  // KAN-731. The Chalk/Charcoal move on the first frame, as the slice makes it at load.
  test.each([
    ['Paper without the flag', '{"theme":"Light"}', CHALK_THEME],
    [
      'Paper with the flag',
      '{"theme":"Light","isChalkCharcoalMoveApplied":true}',
      LIGHT_THEME,
    ],
    ['Graphite without the flag', '{"theme":"Darkenheimer"}', CHARCOAL_THEME],
    [
      'Graphite with the flag',
      '{"theme":"Darkenheimer","isChalkCharcoalMoveApplied":true}',
      DARKENHEIMER_THEME,
    ],
    [
      'Paper with a flag that is not true',
      '{"theme":"Light","isChalkCharcoalMoveApplied":"true"}',
      CHALK_THEME,
    ],
    ['Parchment without the flag', '{"theme":"WarmLight"}', WARM_LIGHT_THEME],
  ])('%s paints its ground', (_, value, palette) => {
    expect(groundFor(stored(value))).toBe(palette.PRIMARY_COLOR);
  });

  // KAN-829. Absent or unknown is Chalk on either OS (KAN-731 picked Charcoal on a dark one).
  describe.each([
    ['light OS', false, CHALK_THEME.PRIMARY_COLOR],
    ['dark OS', true, CHALK_THEME.PRIMARY_COLOR],
  ])('on a %s', (_os, dark, expected) => {
    beforeEach(() => {
      vi.stubGlobal('window', {
        matchMedia: (q: string) => new FakeMediaQueryList(q, dark),
      });
    });

    test.each([
      ['nothing stored', null],
      ['no theme key', '{}'],
      ['malformed JSON', '{theme:'],
      ['an unknown theme', '{"theme":"Neon"}'],
      ['a theme that was never shipped', '{"theme":"Nonsense"}'],
      ['a prototype key', '{"theme":"__proto__"}'],
      ['a number', '{"theme":3}'],
      ['a JSON array', '[1]'],
    ])('%s paints the default', (_, value) => {
      expect(groundFor(stored(value))).toBe(expected);
    });

    test('storage that throws paints the default', () => {
      const throwing = {
        getItem: () => {
          throw new Error('blocked');
        },
      };
      expect(groundFor(throwing)).toBe(expected);
    });

    test('a stored Paper with the move applied stays Paper', () => {
      expect(
        groundFor(stored('{"theme":"Light","isChalkCharcoalMoveApplied":true}'))
      ).toBe(LIGHT_THEME.PRIMARY_COLOR);
    });

    test('a stored Paper without the flag moves to Chalk on either OS', () => {
      expect(groundFor(stored('{"theme":"Light"}'))).toBe(
        CHALK_THEME.PRIMARY_COLOR
      );
    });
  });

  test('nothing stored and no matchMedia paints Chalk', () => {
    vi.stubGlobal('window', {});
    expect(groundFor(stored(null))).toBe(CHALK_THEME.PRIMARY_COLOR);
  });
});
