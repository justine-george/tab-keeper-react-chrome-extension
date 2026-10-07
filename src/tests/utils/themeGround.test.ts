import { afterEach, describe, expect, test } from 'vitest';

import {
  BB_PINK_THEME,
  BLUE_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
} from '../../hooks/useThemeColors';

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

afterEach(() => localStorage.clear());

describe('theme-ground.js', () => {
  test('exists', () => {
    expect(source).toContain('--app-background');
  });

  test.each([
    ['Light', LIGHT_THEME.PRIMARY_COLOR],
    ['WarmLight', WARM_LIGHT_THEME.PRIMARY_COLOR],
    ['BBPink', BB_PINK_THEME.PRIMARY_COLOR],
    ['Darkenheimer', DARKENHEIMER_THEME.PRIMARY_COLOR],
    ['Blue', BLUE_THEME.PRIMARY_COLOR],
  ])('%s paints its PRIMARY_COLOR', (theme, ground) => {
    expect(groundFor(stored(JSON.stringify({ theme })))).toBe(ground);
  });

  test.each([
    ['nothing stored', null],
    ['no theme key', '{}'],
    ['malformed JSON', '{theme:'],
    ['an unknown theme', '{"theme":"Neon"}'],
    ['a prototype key', '{"theme":"__proto__"}'],
    ['a number', '{"theme":3}'],
    ['a JSON array', '[1]'],
  ])('%s paints Light', (_, value) => {
    expect(groundFor(stored(value))).toBe(LIGHT_THEME.PRIMARY_COLOR);
  });

  test('storage that throws paints Light', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(groundFor(throwing)).toBe(LIGHT_THEME.PRIMARY_COLOR);
  });
});
