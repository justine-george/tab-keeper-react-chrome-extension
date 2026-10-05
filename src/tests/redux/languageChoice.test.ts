import { describe, expect, test, vi } from 'vitest';

import { chooseLanguage } from '../../redux/languageChoice';
import { Language } from '../../redux/slices/settingsDataStateSlice';
import { makeTestStore } from '../setup/makeStore';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

// KAN-7 M2. Settings and the setup pick a language through this one function.

describe('chooseLanguage', () => {
  test('re-renders in the language and saves it', () => {
    const { store } = makeTestStore();
    const i18n = { changeLanguage: vi.fn(() => Promise.resolve()) };

    store.dispatch(chooseLanguage(Language.DE, i18n));

    expect(i18n.changeLanguage).toHaveBeenCalledWith('de');
    expect(store.getState().settingsDataState.language).toBe('de');
  });
});
