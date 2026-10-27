import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Theme } from '../../utils/constants/theme';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';

// KAN-731. A first open moves a stored Paper to Chalk and Graphite to Charcoal, once per device; the flag keeps a switch-back.

const setOs = (dark: boolean) =>
  vi.stubGlobal('window', {
    matchMedia: (q: string) => new FakeMediaQueryList(q, dark),
  });

// One page's open: its own module graph over the shared localStorage, so its saves merge against what IT loaded.
async function openPage() {
  vi.resetModules();
  return import('../../redux/slices/settingsDataStateSlice');
}

const stored = (): Record<string, unknown> | null =>
  JSON.parse(localStorage.getItem('settingsData') ?? 'null');
const store = (value: unknown) =>
  localStorage.setItem('settingsData', JSON.stringify(value));

// Settings as 1.9 saved them: the whole object, with no flag.
const olderBuild = (theme: string) => ({
  theme,
  language: 'de',
  timeFormat: 'h23',
  isAutoSync: false,
  setupState: 'done',
});

beforeEach(() => {
  localStorage.clear();
  setOs(false);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe.each([
  ['light', false],
  ['dark', true],
])('on a %s OS, the first open of this version', (_os, dark) => {
  beforeEach(() => setOs(dark));

  it.each([
    ['Paper', Theme.LIGHT, Theme.CHALK],
    ['Graphite', Theme.DARKENHEIMER, Theme.CHARCOAL],
  ])('moves a stored %s', async (_name, from, to) => {
    store(olderBuild(from));
    const { initialState } = await openPage();
    expect(initialState).toMatchObject({
      theme: to,
      isChalkCharcoalMoveApplied: true,
    });
  });

  it.each([
    [Theme.LIGHT, Theme.CHALK],
    [Theme.DARKENHEIMER, Theme.CHARCOAL],
  ])(
    'writes the move of %s at load, every other field kept',
    async (from, to) => {
      store(olderBuild(from));
      await openPage();
      expect(stored()).toEqual({
        ...olderBuild(from),
        theme: to,
        isChalkCharcoalMoveApplied: true,
      });
    }
  );

  it.each([[Theme.WARM_LIGHT], [Theme.BB_PINK], [Theme.BLUE]])(
    'leaves %s alone, and writes nothing',
    async (theme) => {
      store(olderBuild(theme));
      const before = localStorage.getItem('settingsData');
      const { initialState } = await openPage();
      expect(initialState).toMatchObject({
        theme,
        isChalkCharcoalMoveApplied: true,
      });
      expect(localStorage.getItem('settingsData')).toBe(before);
    }
  );

  it.each([[Theme.LIGHT], [Theme.DARKENHEIMER]])(
    'keeps a %s stored with the move applied (a switch-back), and writes nothing',
    async (theme) => {
      store({ ...olderBuild(theme), isChalkCharcoalMoveApplied: true });
      const before = localStorage.getItem('settingsData');
      const { initialState } = await openPage();
      expect(initialState.theme).toBe(theme);
      expect(localStorage.getItem('settingsData')).toBe(before);
    }
  );

  it.each([['"true"'], ['1'], ['null'], ['false']])(
    'moves a Paper whose flag is not true (%s)',
    async (raw) => {
      localStorage.setItem(
        'settingsData',
        `{"theme":"Light","isChalkCharcoalMoveApplied":${raw}}`
      );
      const { initialState } = await openPage();
      expect(initialState).toMatchObject({
        theme: Theme.CHALK,
        isChalkCharcoalMoveApplied: true,
      });
    }
  );

  it('starts a fresh install on the default with the flag set, writing nothing until a save', async () => {
    const { initialState, default: reduce, setTimeFormat } = await openPage();
    expect(initialState).toMatchObject({
      // KAN-829. Chalk on either OS.
      theme: Theme.CHALK,
      isChalkCharcoalMoveApplied: true,
    });
    expect(stored()).toBeNull();

    reduce(initialState, setTimeFormat('h23'));
    expect(stored()).toMatchObject({ isChalkCharcoalMoveApplied: true });
  });
});

describe('after the move', () => {
  it('the next save writes the moved theme and the flag', async () => {
    store(olderBuild(Theme.LIGHT));
    const { initialState, default: reduce, setTimeFormat } = await openPage();
    reduce(initialState, setTimeFormat('h12'));
    expect(stored()).toMatchObject({
      theme: Theme.CHALK,
      isChalkCharcoalMoveApplied: true,
      timeFormat: 'h12',
    });
  });

  it('a switch back to Paper sticks on the next open', async () => {
    store(olderBuild(Theme.LIGHT));
    const first = await openPage();
    first.default(first.initialState, first.setTheme(Theme.LIGHT));

    const next = await openPage();
    expect(next.initialState.theme).toBe(Theme.LIGHT);
  });

  it('a switch back to Graphite sticks on the next open', async () => {
    store(olderBuild(Theme.DARKENHEIMER));
    const first = await openPage();
    first.default(first.initialState, first.setTheme(Theme.DARKENHEIMER));

    const next = await openPage();
    expect(next.initialState.theme).toBe(Theme.DARKENHEIMER);
  });

  it('a fresh install that picks Paper is never moved', async () => {
    const first = await openPage();
    first.default(first.initialState, first.setTheme(Theme.LIGHT));

    const next = await openPage();
    expect(next.initialState.theme).toBe(Theme.LIGHT);
  });

  it('a retired key and the move are written in one go', async () => {
    store({ ...olderBuild(Theme.LIGHT), isUiSoundOn: true });
    await openPage();
    expect(stored()).toEqual({
      ...olderBuild(Theme.LIGHT),
      theme: Theme.CHALK,
      isChalkCharcoalMoveApplied: true,
    });
  });
});

// KAN-661. Two pages open at once: the move must not undo the other page's write.
describe('with two pages open', () => {
  it("a page's later save keeps a switch-back made on the other page, unheard", async () => {
    store(olderBuild(Theme.LIGHT));
    const popup = await openPage();
    const fullView = await openPage();
    // PREMISE: both pages show the move.
    expect(popup.initialState.theme).toBe(Theme.CHALK);
    expect(fullView.initialState.theme).toBe(Theme.CHALK);

    fullView.default(fullView.initialState, fullView.setTheme(Theme.LIGHT));
    // No storage event reaches the popup (KAN-666); it saves something else.
    popup.default(popup.initialState, popup.setTimeFormat('h12'));

    expect(stored()).toMatchObject({
      theme: Theme.LIGHT,
      timeFormat: 'h12',
      isChalkCharcoalMoveApplied: true,
    });
    const next = await openPage();
    expect(next.initialState.theme).toBe(Theme.LIGHT);
  });
});

// KAN-731. Another page's write: the flag is guarded like the pin flag.
describe('another page writing the flag', () => {
  // The store's graph reads window.screen at load; the OS stub has none.
  beforeEach(() =>
    vi.stubGlobal('window', {
      matchMedia: (q: string) => new FakeMediaQueryList(q, false),
      screen: { height: 1080, width: 1920 },
    })
  );

  async function hydrate(written: Record<string, unknown>) {
    vi.resetModules();
    const { makeTestStore } = await import('../setup/makeStore');
    const { applyOtherPageSettings } =
      await import('../../redux/otherPageChanges');
    const { store: page } = makeTestStore();
    const current = page.getState().settingsDataState;
    // PREMISE: this page holds the flag set.
    expect(current.isChalkCharcoalMoveApplied).toBe(true);
    const older = Object.fromEntries(
      Object.entries(current).filter(
        ([key]) => key !== 'isChalkCharcoalMoveApplied'
      )
    );
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ ...older, timeFormat: 'h23', ...written })
    );
    page.dispatch(applyOtherPageSettings());
    return page.getState().settingsDataState;
  }

  it.each([['yes'], [1], [null]])(
    'reads a malformed value (%s) as not applied',
    async (raw) => {
      const next = await hydrate({ isChalkCharcoalMoveApplied: raw });
      expect(next.isChalkCharcoalMoveApplied).toBe(false);
    }
  );

  it('keeps ours when the write lacks it', async () => {
    const next = await hydrate({});
    expect(next).toMatchObject({
      timeFormat: 'h23',
      isChalkCharcoalMoveApplied: true,
    });
  });
});
