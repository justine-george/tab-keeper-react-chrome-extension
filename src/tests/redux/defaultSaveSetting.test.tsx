import { afterEach, describe, expect, it, vi } from 'vitest';

// KAN-635. Settings → Sessions → Default save: all windows unless current window is picked, device-local.
const freshSlice = async () => {
  vi.resetModules();
  return import('../../redux/slices/settingsDataStateSlice');
};

afterEach(() => localStorage.clear());

describe('defaultSaveScope', () => {
  it('is all windows for a new install', async () => {
    const { initialState } = await freshSlice();
    expect(initialState.defaultSaveScope).toBe('all-windows');
  });

  it('is all windows for saved settings written before it existed', async () => {
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ theme: 'Blue', language: 'de' })
    );
    const { initialState } = await freshSlice();
    expect(initialState).toMatchObject({
      theme: 'Blue',
      language: 'de',
      defaultSaveScope: 'all-windows',
    });
  });

  it('keeps a saved current window', async () => {
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ defaultSaveScope: 'current-window' })
    );
    const { initialState } = await freshSlice();
    expect(initialState.defaultSaveScope).toBe('current-window');
  });

  it.each([['"one-window"'], ['"Current-Window"'], ['true'], ['null'], ['1']])(
    'reads a malformed saved value (%s) as all windows',
    async (raw) => {
      localStorage.setItem('settingsData', `{"defaultSaveScope":${raw}}`);
      const { initialState } = await freshSlice();
      expect(initialState.defaultSaveScope).toBe('all-windows');
    }
  );

  it('setDefaultSaveScope changes it and saves it', async () => {
    vi.resetModules();
    const { makeTestStore } = await import('../setup/makeStore');
    const { setDefaultSaveScope } =
      await import('../../redux/slices/settingsDataStateSlice');
    const { store } = makeTestStore();
    store.dispatch(setDefaultSaveScope('current-window'));
    expect(store.getState().settingsDataState.defaultSaveScope).toBe(
      'current-window'
    );
    expect(
      JSON.parse(localStorage.getItem('settingsData') ?? '{}')
    ).toMatchObject({ defaultSaveScope: 'current-window' });
  });
});

describe('another page writing it', () => {
  const setup = async () => {
    vi.resetModules();
    const { makeTestStore } = await import('../setup/makeStore');
    const { applyOtherPageSettings } =
      await import('../../redux/otherPageChanges');
    const { setDefaultSaveScope } =
      await import('../../redux/slices/settingsDataStateSlice');
    return { ...makeTestStore(), applyOtherPageSettings, setDefaultSaveScope };
  };

  it('takes a current window', async () => {
    const { store, applyOtherPageSettings } = await setup();
    localStorage.setItem(
      'settingsData',
      JSON.stringify({
        ...store.getState().settingsDataState,
        defaultSaveScope: 'current-window',
      })
    );
    store.dispatch(applyOtherPageSettings());
    expect(store.getState().settingsDataState.defaultSaveScope).toBe(
      'current-window'
    );
  });

  it('writing settings without it, while this page is current window, keeps current window', async () => {
    const { store, applyOtherPageSettings, setDefaultSaveScope } =
      await setup();
    store.dispatch(setDefaultSaveScope('current-window'));
    const older = Object.fromEntries(
      Object.entries(store.getState().settingsDataState).filter(
        ([key]) => key !== 'defaultSaveScope'
      )
    );
    // PREMISE: the write differs from this page only in the theme, and lacks the key.
    expect(store.getState().settingsDataState.theme).not.toBe('Blue');
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ ...older, theme: 'Blue' })
    );
    store.dispatch(applyOtherPageSettings());
    expect(store.getState().settingsDataState).toMatchObject({
      theme: 'Blue',
      defaultSaveScope: 'current-window',
    });
  });

  it('reads a malformed value as all windows', async () => {
    const { store, applyOtherPageSettings, setDefaultSaveScope } =
      await setup();
    store.dispatch(setDefaultSaveScope('current-window'));
    localStorage.setItem(
      'settingsData',
      JSON.stringify({
        ...store.getState().settingsDataState,
        defaultSaveScope: 'one-window',
      })
    );
    store.dispatch(applyOtherPageSettings());
    expect(store.getState().settingsDataState.defaultSaveScope).toBe(
      'all-windows'
    );
  });
});
