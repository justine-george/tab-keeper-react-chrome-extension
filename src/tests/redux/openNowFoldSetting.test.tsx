import { afterEach, describe, expect, it, vi } from 'vitest';

// KAN-808. The saved session's title-line button folds Open now to its rail.
// One fold at a time: folding either pane shows the other, so the two stored
// flags are never both true.
const freshSlice = async () => {
  vi.resetModules();
  return import('../../redux/slices/settingsDataStateSlice');
};

afterEach(() => localStorage.clear());

describe('foldOpenNowInTabView', () => {
  it('is off for a new install', async () => {
    const { initialState } = await freshSlice();
    expect(initialState.foldOpenNowInTabView).toBe(false);
  });

  it('is off for saved settings written before it existed', async () => {
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ foldSavedSessionInTabView: false })
    );
    const { initialState } = await freshSlice();
    expect(initialState.foldOpenNowInTabView).toBe(false);
  });

  it('keeps a saved on', async () => {
    localStorage.setItem(
      'settingsData',
      JSON.stringify({
        foldSavedSessionInTabView: false,
        foldOpenNowInTabView: true,
      })
    );
    const { initialState } = await freshSlice();
    expect(initialState.foldOpenNowInTabView).toBe(true);
  });

  it.each([['"yes"'], ['1'], ['null']])(
    'reads a malformed saved value (%s) as off',
    async (raw) => {
      localStorage.setItem(
        'settingsData',
        `{"foldSavedSessionInTabView":false,"foldOpenNowInTabView":${raw}}`
      );
      const { initialState } = await freshSlice();
      expect(initialState.foldOpenNowInTabView).toBe(false);
    }
  );

  it('saved with the saved session folded too, the saved session stays folded and Open now does not', async () => {
    localStorage.setItem(
      'settingsData',
      JSON.stringify({
        foldSavedSessionInTabView: true,
        foldOpenNowInTabView: true,
      })
    );
    const { initialState } = await freshSlice();
    expect(initialState).toMatchObject({
      foldSavedSessionInTabView: true,
      foldOpenNowInTabView: false,
    });
  });
});

describe('the two folds', () => {
  const setup = async () => {
    vi.resetModules();
    const { makeTestStore } = await import('../setup/makeStore');
    const slice = await import('../../redux/slices/settingsDataStateSlice');
    const { store } = makeTestStore();
    const folds = () => {
      const s = store.getState().settingsDataState;
      return {
        saved: s.foldSavedSessionInTabView,
        openNow: s.foldOpenNowInTabView,
      };
    };
    return { store, slice, folds };
  };

  it('folding Open now shows the saved session', async () => {
    const { store, slice, folds } = await setup();
    store.dispatch(slice.setFoldSavedSessionInTabView(true));
    store.dispatch(slice.setFoldOpenNowInTabView(true));
    expect(folds()).toEqual({ saved: false, openNow: true });
  });

  it('folding the saved session shows Open now', async () => {
    const { store, slice, folds } = await setup();
    store.dispatch(slice.setFoldSavedSessionInTabView(false));
    store.dispatch(slice.setFoldOpenNowInTabView(true));
    store.dispatch(slice.setFoldSavedSessionInTabView(true));
    expect(folds()).toEqual({ saved: true, openNow: false });
  });

  it('showing Open now again leaves the saved session shown', async () => {
    const { store, slice, folds } = await setup();
    store.dispatch(slice.setFoldOpenNowInTabView(true));
    store.dispatch(slice.setFoldOpenNowInTabView(false));
    expect(folds()).toEqual({ saved: false, openNow: false });
  });

  it('is saved, so the next page opens the same way', async () => {
    const { store, slice } = await setup();
    store.dispatch(slice.setFoldOpenNowInTabView(true));
    expect(JSON.parse(localStorage.getItem('settingsData')!)).toMatchObject({
      foldSavedSessionInTabView: false,
      foldOpenNowInTabView: true,
    });
  });
});

describe('another page writing it', () => {
  const hydrate = async (
    before: (dispatchOn: (on: boolean) => void) => void,
    written: (current: Record<string, unknown>) => Record<string, unknown>
  ) => {
    vi.resetModules();
    const { makeTestStore } = await import('../setup/makeStore');
    const { applyOtherPageSettings } =
      await import('../../redux/otherPageChanges');
    const { setFoldOpenNowInTabView } =
      await import('../../redux/slices/settingsDataStateSlice');
    const { store } = makeTestStore();
    before((on) => store.dispatch(setFoldOpenNowInTabView(on)));
    localStorage.setItem(
      'settingsData',
      JSON.stringify(written({ ...store.getState().settingsDataState }))
    );
    store.dispatch(applyOtherPageSettings());
    const s = store.getState().settingsDataState;
    return {
      saved: s.foldSavedSessionInTabView,
      openNow: s.foldOpenNowInTabView,
    };
  };

  it('takes an on', async () => {
    expect(
      await hydrate(
        () => {},
        (s) => ({
          ...s,
          foldSavedSessionInTabView: false,
          foldOpenNowInTabView: true,
        })
      )
    ).toEqual({ saved: false, openNow: true });
  });

  it('an older page writing settings without it keeps ours', async () => {
    expect(
      await hydrate(
        (on) => on(true),
        (s) =>
          Object.fromEntries(
            Object.entries(s).filter(([key]) => key !== 'foldOpenNowInTabView')
          )
      )
    ).toEqual({ saved: false, openNow: true });
  });

  it('an older page folding the saved session shows Open now here', async () => {
    expect(
      await hydrate(
        (on) => on(true),
        (s) => ({
          ...Object.fromEntries(
            Object.entries(s).filter(([key]) => key !== 'foldOpenNowInTabView')
          ),
          foldSavedSessionInTabView: true,
        })
      )
    ).toEqual({ saved: true, openNow: false });
  });

  it('reads a malformed value as off', async () => {
    expect(
      await hydrate(
        (on) => on(true),
        (s) => ({ ...s, foldOpenNowInTabView: 'yes' })
      )
    ).toEqual({ saved: false, openNow: false });
  });
});
