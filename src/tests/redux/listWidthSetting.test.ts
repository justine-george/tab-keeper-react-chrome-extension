import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load (via
// makeTestStore's rootReducer -> globalStateSlice -> undoRedoSlice chain).
// No `window` exists yet in this node project, so `window` is set to
// `globalThis` itself (rather than a separate object) purely so that
// `window.screen` and `globalThis.screen` name the same property.
vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
  });
});

import { applyOtherPageSettings } from '../../redux/otherPageChanges';
import {
  hydrateSettingsFromOtherPage,
  setListWidth,
  settingsDataStateSlice,
  type SettingsData,
} from '../../redux/slices/settingsDataStateSlice';
import { makeTestStore } from '../setup/makeStore';

// KAN-687. The width the user dragged the saved list to, stored device-local
// in `settingsData` like Open now's, and guarded the same way on both read
// paths (asPaneWidth, tested beside Open now's). paneWidths.ts clamps it.

const freshSlice = async () => {
  vi.resetModules();
  return import('../../redux/slices/settingsDataStateSlice');
};

const actionTypes = (seen: string[]) => seen.filter((t) => t !== 'THUNK');

describe('setListWidth', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('sets a width and writes it to localStorage', () => {
    const state = settingsDataStateSlice.reducer(undefined, setListWidth(500));
    expect(state.listWidth).toBe(500);
    const saved: unknown = JSON.parse(
      localStorage.getItem('settingsData') ?? '{}'
    );
    expect(saved).toMatchObject({ listWidth: 500 });
  });

  it('resets to null (the default) and writes null', () => {
    const withWidth = settingsDataStateSlice.reducer(
      undefined,
      setListWidth(500)
    );
    settingsDataStateSlice.reducer(withWidth, setListWidth(null));
    const saved: unknown = JSON.parse(
      localStorage.getItem('settingsData') ?? '{}'
    );
    expect(saved).toMatchObject({ listWidth: null });
  });
});

describe('the slice starts with a guarded listWidth (KAN-687)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // Garbage in storage -- a hand-edited or corrupted value -- must not reach
  // the grid as `NaNpx`. It reads as null, same as no field at all.
  it('a non-numeric stored value starts as null', async () => {
    localStorage.setItem('settingsData', JSON.stringify({ listWidth: 'wide' }));
    const { initialState } = await freshSlice();
    expect(initialState.listWidth).toBeNull();
  });

  it('a valid stored width survives startup', async () => {
    localStorage.setItem('settingsData', JSON.stringify({ listWidth: 512 }));
    const { initialState } = await freshSlice();
    expect(initialState.listWidth).toBe(512);
  });

  it('no field at all starts as null', async () => {
    localStorage.setItem('settingsData', JSON.stringify({}));
    const { initialState } = await freshSlice();
    expect(initialState.listWidth).toBeNull();
  });
});

describe('applyOtherPageSettings carries listWidth (KAN-687, KAN-279 D9)', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const otherPageWrites = (value: object) =>
    localStorage.setItem('settingsData', JSON.stringify(value));

  it('a garbage stored width leaves the store’s width null, not the string', () => {
    const { store } = makeTestStore();
    const current: SettingsData = store.getState().settingsDataState;

    otherPageWrites({ ...current, listWidth: 'wide' });
    store.dispatch(applyOtherPageSettings());

    expect(store.getState().settingsDataState.listWidth).toBeNull();
  });

  it('a valid width dispatches hydrateSettingsFromOtherPage carrying it', () => {
    const { store, seen, actions } = makeTestStore();
    const current: SettingsData = store.getState().settingsDataState;

    otherPageWrites({ ...current, listWidth: 640 });
    store.dispatch(applyOtherPageSettings());

    expect(store.getState().settingsDataState.listWidth).toBe(640);
    expect(actionTypes(seen)).toEqual([hydrateSettingsFromOtherPage.type]);
    // The D9 path never writes back: no setListWidth in the action log.
    expect(actions.some((a) => a.type === setListWidth.type)).toBe(false);
  });

  // An older page that does not know the field must not reset it: absence is
  // "nothing to say", not "the default".
  it('the field absent from the incoming write keeps the current width', () => {
    const { store, seen } = makeTestStore();
    store.dispatch(setListWidth(555));
    const { listWidth, ...withoutWidth } = store.getState().settingsDataState;
    void listWidth;
    seen.length = 0;

    otherPageWrites({ ...withoutWidth, lastSyncedTime: Date.now() });
    store.dispatch(applyOtherPageSettings());

    expect(store.getState().settingsDataState.listWidth).toBe(555);
    expect(actionTypes(seen)).toEqual([hydrateSettingsFromOtherPage.type]);
    expect(seen.some((t) => t === setListWidth.type)).toBe(false);
  });
});
