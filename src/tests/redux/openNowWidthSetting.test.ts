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
  asOpenNowWidth,
  hydrateSettingsFromOtherPage,
  setOpenNowWidth,
  settingsDataStateSlice,
  type SettingsData,
} from '../../redux/slices/settingsDataStateSlice';
import { makeTestStore } from '../setup/makeStore';

// KAN-321 O1a. The width the user dragged Open now to, stored device-local in
// `settingsData` (localStorage), guarded on both read paths: a fresh startup
// load and another page's write (D9). Only the guard and the plumbing --
// what clamps the STORED width into a SHOWN one is Task 2.

const freshSlice = async () => {
  vi.resetModules();
  return import('../../redux/slices/settingsDataStateSlice');
};

const actionTypes = (seen: string[]) => seen.filter((t) => t !== 'THUNK');

describe('asOpenNowWidth', () => {
  it('rounds a finite positive number to whole px', () => {
    expect(asOpenNowWidth(412)).toBe(412);
    expect(asOpenNowWidth(412.6)).toBe(413);
  });

  // Range (min..max) is the shown-width rule's job (openNowWidth.ts, Task 2):
  // storage cannot know the window's current limits, so a value here is
  // accepted as long as it is a sane stored number.
  it('accepts a value far outside any window range: range-checking is not storage’s job', () => {
    expect(asOpenNowWidth(1e9)).toBe(1e9);
  });

  it.each([0, -5, NaN, Infinity, -Infinity])('rejects %p as null', (value) => {
    expect(asOpenNowWidth(value)).toBeNull();
  });

  it.each(['412', null, undefined, {}, []])('rejects %p as null', (value) => {
    expect(asOpenNowWidth(value)).toBeNull();
  });
});

describe('setOpenNowWidth', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('sets a width and writes it to localStorage', () => {
    const state = settingsDataStateSlice.reducer(
      undefined,
      setOpenNowWidth(500)
    );
    expect(state.openNowWidth).toBe(500);
    const saved: unknown = JSON.parse(
      localStorage.getItem('settingsData') ?? '{}'
    );
    expect(saved).toMatchObject({ openNowWidth: 500 });
  });

  it('resets to null (the default) and writes null', () => {
    const withWidth = settingsDataStateSlice.reducer(
      undefined,
      setOpenNowWidth(500)
    );
    settingsDataStateSlice.reducer(withWidth, setOpenNowWidth(null));
    const saved: unknown = JSON.parse(
      localStorage.getItem('settingsData') ?? '{}'
    );
    expect(saved).toMatchObject({ openNowWidth: null });
  });
});

describe('the slice starts with a guarded openNowWidth (KAN-321 O1a)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // Garbage in storage -- a hand-edited or corrupted value -- must not reach
  // the grid as `NaNpx`. It reads as null, same as no field at all.
  it('a non-numeric stored value starts as null', async () => {
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ openNowWidth: 'wide' })
    );
    const { initialState } = await freshSlice();
    expect(initialState.openNowWidth).toBeNull();
  });

  it('a valid stored width survives startup', async () => {
    localStorage.setItem('settingsData', JSON.stringify({ openNowWidth: 512 }));
    const { initialState } = await freshSlice();
    expect(initialState.openNowWidth).toBe(512);
  });

  it('no field at all starts as null', async () => {
    localStorage.setItem('settingsData', JSON.stringify({}));
    const { initialState } = await freshSlice();
    expect(initialState.openNowWidth).toBeNull();
  });
});

describe('applyOtherPageSettings carries openNowWidth (KAN-321 O1a, KAN-279 D9)', () => {
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

    otherPageWrites({ ...current, openNowWidth: 'wide' });
    store.dispatch(applyOtherPageSettings());

    expect(store.getState().settingsDataState.openNowWidth).toBeNull();
  });

  it('a valid width dispatches hydrateSettingsFromOtherPage carrying it', () => {
    const { store, seen, actions } = makeTestStore();
    const current: SettingsData = store.getState().settingsDataState;

    otherPageWrites({ ...current, openNowWidth: 640 });
    store.dispatch(applyOtherPageSettings());

    expect(store.getState().settingsDataState.openNowWidth).toBe(640);
    expect(actionTypes(seen)).toEqual([hydrateSettingsFromOtherPage.type]);
    // The D9 path never writes back: no setOpenNowWidth in the action log.
    expect(actions.some((a) => a.type === setOpenNowWidth.type)).toBe(false);
  });

  // An older page that does not know the field must not reset it: absence is
  // "nothing to say", not "the default".
  it('the field absent from the incoming write keeps the current width', () => {
    const { store, seen } = makeTestStore();
    store.dispatch(setOpenNowWidth(555));
    const { openNowWidth, ...withoutWidth } =
      store.getState().settingsDataState;
    void openNowWidth;
    seen.length = 0;

    otherPageWrites({ ...withoutWidth, lastSyncedTime: Date.now() });
    store.dispatch(applyOtherPageSettings());

    expect(store.getState().settingsDataState.openNowWidth).toBe(555);
    expect(actionTypes(seen)).toEqual([hydrateSettingsFromOtherPage.type]);
    expect(seen.some((t) => t === setOpenNowWidth.type)).toBe(false);
  });
});
