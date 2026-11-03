import { afterEach, describe, expect, it, vi } from 'vitest';

// Inlined: common.ts reads window.screen at module load, and this file runs without a DOM.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

// KAN-906. Settings › Sessions › Skip duplicate tabs: on or off, device-local, off by default.
const freshSlice = async () => {
  vi.resetModules();
  return import('../../redux/slices/settingsDataStateSlice');
};

afterEach(() => localStorage.clear());

describe('skipDuplicateTabs in the store', () => {
  it('is off for a new install and for settings written before it existed', async () => {
    expect((await freshSlice()).initialState.skipDuplicateTabs).toBe(false);
    localStorage.setItem('settingsData', JSON.stringify({ theme: 'Blue' }));
    expect((await freshSlice()).initialState).toMatchObject({
      theme: 'Blue',
      skipDuplicateTabs: false,
    });
  });

  it('keeps a saved true, and reads any stored non-boolean as off', async () => {
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ skipDuplicateTabs: true })
    );
    expect((await freshSlice()).initialState.skipDuplicateTabs).toBe(true);
    for (const stored of ['true', 1, 'on', {}, null]) {
      localStorage.setItem(
        'settingsData',
        JSON.stringify({ skipDuplicateTabs: stored })
      );
      expect((await freshSlice()).initialState.skipDuplicateTabs).toBe(false);
    }
  });

  it('setSkipDuplicateTabs changes it and saves it', async () => {
    vi.resetModules();
    const { makeTestStore } = await import('../setup/makeStore');
    const { setSkipDuplicateTabs } =
      await import('../../redux/slices/settingsDataStateSlice');
    const { store } = makeTestStore();
    store.dispatch(setSkipDuplicateTabs(true));
    expect(store.getState().settingsDataState.skipDuplicateTabs).toBe(true);
    expect(
      JSON.parse(localStorage.getItem('settingsData') ?? '{}')
    ).toMatchObject({ skipDuplicateTabs: true });
    store.dispatch(setSkipDuplicateTabs(false));
    expect(store.getState().settingsDataState.skipDuplicateTabs).toBe(false);
    expect(
      JSON.parse(localStorage.getItem('settingsData') ?? '{}')
    ).toMatchObject({ skipDuplicateTabs: false });
  });
});
