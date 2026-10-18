import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import i18next from 'i18next';

// common.ts reads window.screen at module load. In node, window is made
// globalThis itself, so window.screen is the screen set beside it.
vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
  });
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
}));

import { makeTestStore } from '../setup/makeStore';
import {
  Language,
  setTheme,
  setTimeFormat,
  type SettingsData,
} from '../../redux/slices/settingsDataStateSlice';
import { applyOtherPageSettings } from '../../redux/otherPageChanges';
import { Theme } from '../../utils/constants/theme';
import { saveLocalSettings } from '../../utils/functions/localSettings';

// KAN-661. The settings half of KAN-666: Chrome sometimes never fires the
// storage event for another page's write, and this page's next settings save
// must not put the old values back.

const stored = (): Partial<SettingsData> =>
  JSON.parse(localStorage.getItem('settingsData') ?? 'null');

// Another page's write, with no storage event here: what this page last
// stored, with the other page's change on top.
const otherPageWritesUnheard = (change: Partial<SettingsData>) =>
  localStorage.setItem(
    'settingsData',
    JSON.stringify({ ...stored(), ...change })
  );

// A page that has loaded and saved once, so storage holds its settings.
function loadedPage() {
  const { store } = makeTestStore();
  store.dispatch(setTimeFormat('h12'));
  store.dispatch(setTheme(Theme.LIGHT));
  return store;
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('a settings write from another page this page never heard (KAN-661)', () => {
  test("this page's next save keeps it, in storage and on screen", () => {
    const store = loadedPage();
    otherPageWritesUnheard({ timeFormat: 'h23' });

    store.dispatch(setTheme(Theme.DARKENHEIMER));

    expect(stored()).toMatchObject({
      timeFormat: 'h23',
      theme: Theme.DARKENHEIMER,
    });
    expect(store.getState().settingsDataState).toMatchObject({
      timeFormat: 'h23',
      theme: Theme.DARKENHEIMER,
    });
  });

  test('a field both pages changed keeps this page’s', () => {
    const store = loadedPage();
    otherPageWritesUnheard({ theme: Theme.BLUE });

    store.dispatch(setTheme(Theme.DARKENHEIMER));

    expect(stored().theme).toBe(Theme.DARKENHEIMER);
    expect(store.getState().settingsDataState.theme).toBe(Theme.DARKENHEIMER);
  });

  // The take-in moves what the next merge compares against: a value taken in
  // and then changed again elsewhere is the other page's, not this one's.
  test('after a take-in, a later unheard change to the same field is kept', () => {
    const store = loadedPage();
    otherPageWritesUnheard({ theme: Theme.DARKENHEIMER });
    store.dispatch(applyOtherPageSettings());
    otherPageWritesUnheard({ theme: Theme.BLUE });

    store.dispatch(setTimeFormat('h23'));

    expect(stored()).toMatchObject({ theme: Theme.BLUE, timeFormat: 'h23' });
    expect(store.getState().settingsDataState.theme).toBe(Theme.BLUE);
  });

  // The page has not taken it in yet, so a second save must merge it again.
  test('a second save before the take-in still keeps it', () => {
    const store = loadedPage();
    otherPageWritesUnheard({ timeFormat: 'h23' });
    const page = store.getState().settingsDataState;

    saveLocalSettings({ ...page, theme: Theme.DARKENHEIMER });
    saveLocalSettings({ ...page, theme: Theme.BLUE });

    expect(stored()).toMatchObject({ timeFormat: 'h23', theme: Theme.BLUE });
  });

  test('a language taken in reaches i18next', () => {
    const change = vi
      .spyOn(i18next, 'changeLanguage')
      .mockResolvedValue((key: string) => key);
    const store = loadedPage();
    otherPageWritesUnheard({ language: Language.DE });

    store.dispatch(setTheme(Theme.DARKENHEIMER));

    expect(store.getState().settingsDataState.language).toBe(Language.DE);
    expect(change).toHaveBeenCalledWith(Language.DE);
  });

  test('unreadable storage is written over, as before', () => {
    const store = loadedPage();
    localStorage.setItem('settingsData', '{not json');

    store.dispatch(setTheme(Theme.DARKENHEIMER));

    expect(stored().theme).toBe(Theme.DARKENHEIMER);
  });
});

describe('a settings save with no other write in between (KAN-661)', () => {
  // A field the page guarded at load differs from storage. With no other
  // write, the save is the page's own, and corrects storage as before.
  test('writes the page as it is', () => {
    localStorage.setItem('settingsData', JSON.stringify({ timeFormat: 'x' }));
    const { store } = makeTestStore();
    const page = store.getState().settingsDataState;
    expect(page.timeFormat).toBe('h12');

    store.dispatch(setTheme(Theme.DARKENHEIMER));

    expect(stored()).toEqual({ ...page, theme: Theme.DARKENHEIMER });
  });

  test('takes nothing in', () => {
    const change = vi.spyOn(i18next, 'changeLanguage');
    const store = loadedPage();
    const before = store.getState().settingsDataState;

    store.dispatch(setTheme(Theme.DARKENHEIMER));

    expect(store.getState().settingsDataState).toEqual({
      ...before,
      theme: Theme.DARKENHEIMER,
    });
    expect(change).not.toHaveBeenCalled();
  });
});
