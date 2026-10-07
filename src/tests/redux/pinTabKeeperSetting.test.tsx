import { afterEach, describe, expect, it, vi } from 'vitest';

// KAN-459. Settings → Sessions → Pin Tab Keeper in new windows: Off unless turned on, device-local.
const freshSlice = async () => {
  vi.resetModules();
  return import('../../redux/slices/settingsDataStateSlice');
};
const saved = (): unknown =>
  JSON.parse(localStorage.getItem('settingsData') ?? '{}');

afterEach(() => localStorage.clear());

describe('pinTabKeeperInNewWindows', () => {
  it('is Off for a new install', async () => {
    const { initialState } = await freshSlice();
    expect(initialState.pinTabKeeperInNewWindows).toBe(false);
  });

  it('is Off for saved settings written before it existed', async () => {
    localStorage.setItem('settingsData', JSON.stringify({ theme: 'Blue' }));
    const { initialState } = await freshSlice();
    expect(initialState).toMatchObject({
      theme: 'Blue',
      pinTabKeeperInNewWindows: false,
    });
  });

  it('keeps a saved On', async () => {
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ pinTabKeeperInNewWindows: true })
    );
    const { initialState } = await freshSlice();
    expect(initialState.pinTabKeeperInNewWindows).toBe(true);
  });

  it.each([['"yes"'], ['1'], ['null']])(
    'reads a malformed saved value (%s) as Off',
    async (raw) => {
      localStorage.setItem(
        'settingsData',
        `{"pinTabKeeperInNewWindows":${raw}}`
      );
      const { initialState } = await freshSlice();
      expect(initialState.pinTabKeeperInNewWindows).toBe(false);
    }
  );

  it('setPinTabKeeperInNewWindows sets it and saves it', async () => {
    const { settingsDataStateSlice, setPinTabKeeperInNewWindows } =
      await freshSlice();
    const on = settingsDataStateSlice.reducer(
      undefined,
      setPinTabKeeperInNewWindows(true)
    );
    expect(on.pinTabKeeperInNewWindows).toBe(true);
    expect(saved()).toMatchObject({ pinTabKeeperInNewWindows: true });
    const off = settingsDataStateSlice.reducer(
      on,
      setPinTabKeeperInNewWindows(false)
    );
    expect(off.pinTabKeeperInNewWindows).toBe(false);
    expect(saved()).toMatchObject({ pinTabKeeperInNewWindows: false });
  });
});

describe('another page writing it', () => {
  const hydrate = async (written: Record<string, unknown>) => {
    vi.resetModules();
    const { makeTestStore } = await import('../setup/makeStore');
    const { applyOtherPageSettings } = await import(
      '../../redux/otherPageChanges'
    );
    const { store } = makeTestStore();
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ ...store.getState().settingsDataState, ...written })
    );
    store.dispatch(applyOtherPageSettings());
    return store.getState().settingsDataState.pinTabKeeperInNewWindows;
  };

  it('takes an On', async () => {
    expect(await hydrate({ pinTabKeeperInNewWindows: true })).toBe(true);
  });

  it('reads a malformed value as Off', async () => {
    expect(await hydrate({ pinTabKeeperInNewWindows: 'yes' })).toBe(false);
  });
});
