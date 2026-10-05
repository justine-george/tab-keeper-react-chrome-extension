import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnknownAction } from '@reduxjs/toolkit';

// common.ts reads window.screen at module load; this node project has no window.
vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
  });
});

import { applyOtherPageSettings } from '../../redux/otherPageChanges';
import {
  asSetupState,
  beginSetup,
  countWelcomeShow,
  endFirstRun,
  dismissPinGuide,
  finishSetup,
  guardOnboarding,
  markFullViewCalloutSeen,
  markFullViewOpened,
  markWhatsNew2Seen,
  ONBOARDING_DEFAULTS,
  recordFirstRun,
  setFirstRunSession,
  setFirstRunStep,
  setDefaultView,
  settingsDataStateSlice,
  type SettingsData,
} from '../../redux/slices/settingsDataStateSlice';
import { asDefaultView } from '../../utils/functions/defaultView';
import { newRun } from '../../utils/functions/firstRun';
import { makeTestStore } from '../setup/makeStore';

// KAN-7. Six per-machine answers in settingsData, each guarded on both read
// paths: this page's startup and another page's write (KAN-279 D9).

const freshSlice = async () => {
  vi.resetModules();
  return import('../../redux/slices/settingsDataStateSlice');
};

const saved = (): unknown =>
  JSON.parse(localStorage.getItem('settingsData') ?? '{}');

const GARBAGE = {
  setupState: 'later',
  isPinGuideDismissed: 1,
  hasOpenedFullView: 'true',
  isFullViewCalloutSeen: {},
  defaultView: 'tab',
  firstRun: { view: 'tab', step: 1 },
  isWhatsNew2Seen: 'yes',
};

const ALL_SET = {
  setupState: 'done',
  isPinGuideDismissed: true,
  hasOpenedFullView: true,
  isFullViewCalloutSeen: true,
  defaultView: 'full',
  firstRun: {
    view: 'full',
    step: 3,
    sessionId: 'abc',
    hello: 'whatsNew',
    welcomeShows: null,
    ended: null,
  },
  isWhatsNew2Seen: true,
} as const;

const ONBOARDING_KEYS: string[] = Object.keys(ONBOARDING_DEFAULTS);

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the guards', () => {
  it.each(['pending', 'done'] as const)('keeps setupState %p', (value) => {
    expect(asSetupState(value)).toBe(value);
  });

  it.each(['none', 'PENDING', '', 1, null, undefined, {}, true])(
    'reads setupState %p as none',
    (value) => {
      expect(asSetupState(value)).toBe('none');
    }
  );

  it('keeps defaultView full', () => {
    expect(asDefaultView('full')).toBe('full');
  });

  it.each(['compact', 'FULL', '', null, undefined, 1])(
    'reads defaultView %p as compact',
    (value) => {
      expect(asDefaultView(value)).toBe('compact');
    }
  );

  it('reads every garbage field as its default', () => {
    expect(
      guardOnboarding(GARBAGE, { ...ONBOARDING_DEFAULTS, ...ALL_SET })
    ).toEqual(ONBOARDING_DEFAULTS);
  });

  it('keeps the fallback for a field that is absent', () => {
    expect(guardOnboarding({}, { ...ONBOARDING_DEFAULTS, ...ALL_SET })).toEqual(
      {
        ...ONBOARDING_DEFAULTS,
        ...ALL_SET,
      }
    );
  });

  it.each([null, 'settings', 7, []])(
    'keeps the fallback when what is stored is not an object (%p)',
    (stored) => {
      expect(
        guardOnboarding(stored, { ...ONBOARDING_DEFAULTS, ...ALL_SET })
      ).toEqual({
        ...ONBOARDING_DEFAULTS,
        ...ALL_SET,
      });
    }
  );

  it('keeps every valid value', () => {
    expect(guardOnboarding(ALL_SET, ONBOARDING_DEFAULTS)).toEqual(ALL_SET);
  });
});

describe('the slice starts with guarded onboarding fields', () => {
  it('garbage on disk starts as the defaults', async () => {
    localStorage.setItem('settingsData', JSON.stringify(GARBAGE));
    const { initialState } = await freshSlice();
    expect(initialState).toMatchObject(ONBOARDING_DEFAULTS);
  });

  it('valid values on disk survive startup', async () => {
    localStorage.setItem('settingsData', JSON.stringify(ALL_SET));
    const { initialState } = await freshSlice();
    expect(initialState).toMatchObject(ALL_SET);
  });

  it('settings saved before KAN-7 start as the defaults', async () => {
    localStorage.setItem('settingsData', JSON.stringify({ theme: 'Blue' }));
    const { initialState } = await freshSlice();
    expect(initialState).toMatchObject({
      theme: 'Blue',
      ...ONBOARDING_DEFAULTS,
    });
  });
});

describe('the onboarding reducers persist what they set', () => {
  const reduce = (actions: UnknownAction[]) =>
    actions.reduce(
      (state, action) => settingsDataStateSlice.reducer(state, action),
      settingsDataStateSlice.getInitialState()
    );

  it('beginSetup moves none to pending', () => {
    expect(reduce([beginSetup()]).setupState).toBe('pending');
    expect(saved()).toMatchObject({ setupState: 'pending' });
  });

  // A second Welcome close, after setup ended, must never restart it.
  it('beginSetup leaves a finished setup finished', () => {
    expect(reduce([finishSetup(), beginSetup()]).setupState).toBe('done');
    expect(saved()).toMatchObject({ setupState: 'done' });
  });

  it.each([
    ['finishSetup', finishSetup(), { setupState: 'done' }],
    ['dismissPinGuide', dismissPinGuide(), { isPinGuideDismissed: true }],
    ['markFullViewOpened', markFullViewOpened(), { hasOpenedFullView: true }],
    [
      'markFullViewCalloutSeen',
      markFullViewCalloutSeen(),
      { isFullViewCalloutSeen: true },
    ],
    ['setDefaultView', setDefaultView('full'), { defaultView: 'full' }],
  ] as const)('%s sets and saves', (_name, action, expected) => {
    expect(reduce([action])).toMatchObject(expected);
    expect(saved()).toMatchObject(expected);
  });

  // Every full-view open dispatches it; a write each time would fire a
  // storage event in every other open page for nothing.
  it.each([
    ['markFullViewOpened', markFullViewOpened()],
    ['markFullViewCalloutSeen', markFullViewCalloutSeen()],
  ] as const)('%s writes only the first time', (_name, action) => {
    const once = reduce([action]);
    const setItem = vi.spyOn(localStorage, 'setItem');
    // vitest-localstorage-mock's setItem is already a spy, with the first write's call.
    setItem.mockClear();
    settingsDataStateSlice.reducer(once, action);
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe('applyOtherPageSettings carries the onboarding fields (KAN-279 D9)', () => {
  const otherPageWrites = (value: object) =>
    localStorage.setItem('settingsData', JSON.stringify(value));

  it('garbage from another page reads as the defaults, not the strings', () => {
    const { store } = makeTestStore();
    store.dispatch(finishSetup());
    store.dispatch(setDefaultView('full'));
    const current: SettingsData = store.getState().settingsDataState;

    otherPageWrites({ ...current, ...GARBAGE });
    store.dispatch(applyOtherPageSettings());

    expect(store.getState().settingsDataState).toMatchObject(
      ONBOARDING_DEFAULTS
    );
  });

  // An older page that does not know the fields must not reset them.
  it('a write without the fields keeps this page’s answers', () => {
    const { store } = makeTestStore();
    store.dispatch(finishSetup());
    store.dispatch(setDefaultView('full'));
    store.dispatch(dismissPinGuide());
    const older = Object.fromEntries(
      Object.entries(store.getState().settingsDataState).filter(
        ([key]) => !ONBOARDING_KEYS.includes(key)
      )
    );

    otherPageWrites({ ...older, lastSyncedTime: Date.now() });
    store.dispatch(applyOtherPageSettings());

    expect(store.getState().settingsDataState).toMatchObject({
      setupState: 'done',
      defaultView: 'full',
      isPinGuideDismissed: true,
    });
  });

  it('valid answers from another page are taken in', () => {
    const { store } = makeTestStore();
    const current: SettingsData = store.getState().settingsDataState;

    otherPageWrites({ ...current, ...ALL_SET });
    store.dispatch(applyOtherPageSettings());

    expect(store.getState().settingsDataState).toMatchObject(ALL_SET);
  });
});

describe('the run record', () => {
  const reduce = (actions: UnknownAction[]) =>
    actions.reduce(
      (state, action) => settingsDataStateSlice.reducer(state, action),
      settingsDataStateSlice.getInitialState()
    );
  const FULL = newRun('full', 0);

  it('recordFirstRun replaces any record and saves it', () => {
    const state = reduce([
      recordFirstRun(newRun('popup', 3)),
      recordFirstRun(FULL),
    ]);
    expect(state.firstRun).toEqual(FULL);
    expect(saved()).toMatchObject({ firstRun: FULL });
  });

  it('setFirstRunStep moves both ways, within the view, never back to step 0', () => {
    expect(
      reduce([recordFirstRun(FULL), setFirstRunStep(5), setFirstRunStep(4)])
        .firstRun?.step
    ).toBe(4);
    expect(
      reduce([recordFirstRun(newRun('popup', 1)), setFirstRunStep(8)]).firstRun
        ?.step
    ).toBe(1);
    expect(
      reduce([recordFirstRun(FULL), setFirstRunStep(2), setFirstRunStep(0)])
        .firstRun?.step
    ).toBe(2);
    expect(saved()).toMatchObject({ firstRun: { step: 2 } });
  });

  it('leaving the popup welcome drops its show count', () => {
    expect(
      reduce([recordFirstRun(newRun('popup', 0)), setFirstRunStep(1)]).firstRun
    ).toMatchObject({ step: 1, welcomeShows: null });
  });

  it('countWelcomeShow counts the second show, and only on the welcome', () => {
    expect(
      reduce([recordFirstRun(newRun('popup', 0)), countWelcomeShow()]).firstRun
        ?.welcomeShows
    ).toBe(2);
    expect(
      reduce([recordFirstRun(newRun('popup', 2)), countWelcomeShow()]).firstRun
        ?.welcomeShows
    ).toBeNull();
  });

  it('an ended record takes no step, session or second ending', () => {
    const state = reduce([
      recordFirstRun(FULL),
      endFirstRun('skipped'),
      setFirstRunStep(3),
      setFirstRunSession('abc'),
      endFirstRun('finished'),
    ]);
    expect(state.firstRun).toEqual({ ...FULL, ended: 'skipped' });
  });

  it('with no record, the run reducers change nothing and write nothing', () => {
    const setItem = vi.spyOn(localStorage, 'setItem');
    setItem.mockClear();
    const state = reduce([
      setFirstRunStep(2),
      setFirstRunSession('abc'),
      countWelcomeShow(),
      endFirstRun('finished'),
    ]);
    expect(state.firstRun).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('markWhatsNew2Seen sets and saves, once', () => {
    expect(reduce([markWhatsNew2Seen()]).isWhatsNew2Seen).toBe(true);
    expect(saved()).toMatchObject({ isWhatsNew2Seen: true });
  });

  it('a write from an older page keeps this page’s record', () => {
    const { store } = makeTestStore();
    store.dispatch(recordFirstRun(FULL));
    const older = Object.fromEntries(
      Object.entries(store.getState().settingsDataState).filter(
        ([key]) => key !== 'firstRun'
      )
    );
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ ...older, lastSyncedTime: Date.now() })
    );
    store.dispatch(applyOtherPageSettings());
    expect(store.getState().settingsDataState.firstRun).toEqual(FULL);
  });
});

describe('keys only unreleased builds wrote: the KAN-413 record and the offer’s answer (§11)', () => {
  const SESSIONS = JSON.stringify({
    lastModified: 1,
    selectedTabGroupId: null,
    tabGroups: [{ tabGroupId: 'sample:a', title: 'Sample: Weekend trip' }],
  });

  it('are dropped on load and written back once, leaving the sessions on disk alone', async () => {
    localStorage.setItem('tabContainerData', SESSIONS);
    localStorage.setItem(
      'settingsData',
      JSON.stringify({
        theme: 'Blue',
        sampleTour: { sampleId: 'sample:a', step: 2, view: 'popup' },
        isFullViewOfferAnswered: true,
      })
    );
    const { initialState } = await freshSlice();
    expect(Object.keys(initialState)).not.toContain('sampleTour');
    expect(Object.keys(initialState)).not.toContain('isFullViewOfferAnswered');
    expect(saved()).toEqual({ theme: 'Blue' });
    expect(localStorage.getItem('tabContainerData')).toBe(SESSIONS);
  });

  it('settings without them are not written at load', async () => {
    localStorage.setItem('settingsData', JSON.stringify({ theme: 'Blue' }));
    const setItem = vi.spyOn(localStorage, 'setItem');
    setItem.mockClear();
    await freshSlice();
    expect(setItem).not.toHaveBeenCalled();
  });
});
