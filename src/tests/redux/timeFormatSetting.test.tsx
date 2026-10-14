import { afterEach, describe, expect, it, vi } from 'vitest';

// KAN-587. Settings → Display → Time format: 12-hour unless 24-hour is picked, device-local.
const freshSlice = async () => {
  vi.resetModules();
  return import('../../redux/slices/settingsDataStateSlice');
};

afterEach(() => localStorage.clear());

describe('timeFormat', () => {
  it('is 12-hour for a new install', async () => {
    const { initialState } = await freshSlice();
    expect(initialState.timeFormat).toBe('h12');
  });

  it('is 12-hour for saved settings written before it existed, whatever the language', async () => {
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ theme: 'Blue', language: 'de' })
    );
    const { initialState } = await freshSlice();
    expect(initialState).toMatchObject({
      theme: 'Blue',
      language: 'de',
      timeFormat: 'h12',
    });
  });

  it('keeps a saved 24-hour', async () => {
    localStorage.setItem('settingsData', JSON.stringify({ timeFormat: 'h23' }));
    const { initialState } = await freshSlice();
    expect(initialState.timeFormat).toBe('h23');
  });

  it.each([['"h24"'], ['"24"'], ['true'], ['null'], ['"H23"']])(
    'reads a malformed saved value (%s) as 12-hour',
    async (raw) => {
      localStorage.setItem('settingsData', `{"timeFormat":${raw}}`);
      const { initialState } = await freshSlice();
      expect(initialState.timeFormat).toBe('h12');
    }
  );

  it('setTimeFormat changes it and saves it', async () => {
    vi.resetModules();
    const { makeTestStore } = await import('../setup/makeStore');
    const { setTimeFormat } =
      await import('../../redux/slices/settingsDataStateSlice');
    const { store } = makeTestStore();
    store.dispatch(setTimeFormat('h23'));
    expect(store.getState().settingsDataState.timeFormat).toBe('h23');
    expect(
      JSON.parse(localStorage.getItem('settingsData') ?? '{}')
    ).toMatchObject({ timeFormat: 'h23' });
  });
});

describe('another page writing it', () => {
  const setup = async () => {
    vi.resetModules();
    const { makeTestStore } = await import('../setup/makeStore');
    const { applyOtherPageSettings } =
      await import('../../redux/otherPageChanges');
    const { setTimeFormat } =
      await import('../../redux/slices/settingsDataStateSlice');
    return { ...makeTestStore(), applyOtherPageSettings, setTimeFormat };
  };

  it('takes a 24-hour', async () => {
    const { store, applyOtherPageSettings } = await setup();
    localStorage.setItem(
      'settingsData',
      JSON.stringify({
        ...store.getState().settingsDataState,
        timeFormat: 'h23',
      })
    );
    store.dispatch(applyOtherPageSettings());
    expect(store.getState().settingsDataState.timeFormat).toBe('h23');
  });

  it('writing settings without it, while this page is 24-hour, keeps 24-hour', async () => {
    const { store, applyOtherPageSettings, setTimeFormat } = await setup();
    store.dispatch(setTimeFormat('h23'));
    const older = Object.fromEntries(
      Object.entries(store.getState().settingsDataState).filter(
        ([key]) => key !== 'timeFormat'
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
      timeFormat: 'h23',
    });
  });

  it('reads a malformed value as 12-hour', async () => {
    const { store, applyOtherPageSettings, setTimeFormat } = await setup();
    store.dispatch(setTimeFormat('h23'));
    localStorage.setItem(
      'settingsData',
      JSON.stringify({
        ...store.getState().settingsDataState,
        timeFormat: 'h24',
      })
    );
    store.dispatch(applyOtherPageSettings());
    expect(store.getState().settingsDataState.timeFormat).toBe('h12');
  });
});
