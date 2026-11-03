import { afterEach, describe, expect, it, vi } from 'vitest';

// Inlined: common.ts reads window.screen at module load, and this file runs without a DOM.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

// KAN-910. Settings › Sessions › Skip tabs already open: on or off, device-local, off by default.
const freshSlice = async () => {
  vi.resetModules();
  return import('../../redux/slices/settingsDataStateSlice');
};

afterEach(() => localStorage.clear());

describe('skipTabsAlreadyOpen in the store', () => {
  it('is off for a new install and for settings written before it existed', async () => {
    expect((await freshSlice()).initialState.skipTabsAlreadyOpen).toBe(false);
    localStorage.setItem('settingsData', JSON.stringify({ theme: 'Blue' }));
    expect((await freshSlice()).initialState).toMatchObject({
      theme: 'Blue',
      skipTabsAlreadyOpen: false,
    });
  });

  it('keeps a saved true, and reads any stored non-boolean as off', async () => {
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ skipTabsAlreadyOpen: true })
    );
    expect((await freshSlice()).initialState.skipTabsAlreadyOpen).toBe(true);
    for (const stored of ['true', 1, 'on', {}, null]) {
      localStorage.setItem(
        'settingsData',
        JSON.stringify({ skipTabsAlreadyOpen: stored })
      );
      expect((await freshSlice()).initialState.skipTabsAlreadyOpen).toBe(false);
    }
  });

  it('setSkipTabsAlreadyOpen changes it and saves it', async () => {
    vi.resetModules();
    const { makeTestStore } = await import('../setup/makeStore');
    const { setSkipTabsAlreadyOpen } =
      await import('../../redux/slices/settingsDataStateSlice');
    const { store } = makeTestStore();
    store.dispatch(setSkipTabsAlreadyOpen(true));
    expect(store.getState().settingsDataState.skipTabsAlreadyOpen).toBe(true);
    expect(
      JSON.parse(localStorage.getItem('settingsData') ?? '{}')
    ).toMatchObject({ skipTabsAlreadyOpen: true });
    store.dispatch(setSkipTabsAlreadyOpen(false));
    expect(store.getState().settingsDataState.skipTabsAlreadyOpen).toBe(false);
    expect(
      JSON.parse(localStorage.getItem('settingsData') ?? '{}')
    ).toMatchObject({ skipTabsAlreadyOpen: false });
  });
});
