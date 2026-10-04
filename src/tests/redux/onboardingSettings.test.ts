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
  answerFullViewOffer,
  asSetupState,
  beginSetup,
  dismissPinGuide,
  finishSetup,
  guardOnboarding,
  markFullViewCalloutSeen,
  markFullViewOpened,
  ONBOARDING_DEFAULTS,
  setDefaultView,
  settingsDataStateSlice,
  type SettingsData,
} from '../../redux/slices/settingsDataStateSlice';
import { asDefaultView } from '../../utils/functions/defaultView';
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
  isFullViewOfferAnswered: 'yes',
  isPinGuideDismissed: 1,
  hasOpenedFullView: 'true',
  isFullViewCalloutSeen: {},
  defaultView: 'tab',
};

const ALL_SET = {
  setupState: 'done',
  isFullViewOfferAnswered: true,
  isPinGuideDismissed: true,
  hasOpenedFullView: true,
  isFullViewCalloutSeen: true,
  defaultView: 'full',
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
    [
      'answerFullViewOffer',
      answerFullViewOffer(),
      { isFullViewOfferAnswered: true },
    ],
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
