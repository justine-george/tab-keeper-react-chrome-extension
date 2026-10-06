import { describe, expect, test, vi } from 'vitest';

import {
  asFirstRun,
  asRunStep,
  isFirstFullViewVisit,
  isNeverSaved19User,
  isSessionListSettled,
  isUpgrader,
  latestSession,
  needsSession,
  newRun,
  nextRunStep,
  previousRunStep,
  runAtOpen,
  runStepKind,
  type FirstRun,
  type StoredAtOpen,
} from '../../../utils/functions/firstRun';
import { buildSession } from '../../fixtures/sessionFixture';

// §11. The run's record, its steps, and what each open does with it.

const FULL_AT_3: FirstRun = { ...newRun('full', 3), sessionId: 'abc' };
const held = () => Promise.resolve('held' as const);
const free = () => Promise.resolve('free' as const);
const unknown = () => Promise.resolve('unknown' as const);

describe('asFirstRun', () => {
  test('keeps a valid record, and only the fields it knows', () => {
    expect(asFirstRun({ ...FULL_AT_3, extra: 1 })).toEqual(FULL_AT_3);
  });

  test('keeps an ended record', () => {
    const ended = { ...FULL_AT_3, ended: 'skipped' };
    expect(asFirstRun(ended)).toEqual(ended);
  });

  test('keeps the popup welcome with its show count', () => {
    expect(asFirstRun({ ...newRun('popup', 0), welcomeShows: 2 })).toEqual({
      ...newRun('popup', 0),
      welcomeShows: 2,
    });
  });

  test.each([
    ['null', null],
    ['an array', [FULL_AT_3]],
    ['another view', { ...FULL_AT_3, view: 'tab' }],
    ['full step 9', { ...FULL_AT_3, step: 9 }],
    ['popup step 8', { ...newRun('popup', 1), step: 8 }],
    ['a step as text', { ...FULL_AT_3, step: '3' }],
    ['a numeric session id', { ...FULL_AT_3, sessionId: 7 }],
    ['another hello', { ...FULL_AT_3, hello: 'hi' }],
    ['another ending', { ...FULL_AT_3, ended: 'done' }],
    [
      'the popup welcome with no count',
      { ...newRun('popup', 0), welcomeShows: null },
    ],
    ['a count off the welcome', { ...newRun('popup', 1), welcomeShows: 1 }],
    ['a count of 3', { ...newRun('popup', 0), welcomeShows: 3 }],
  ])('reads %s as no record', (_name, value) => {
    expect(asFirstRun(value)).toBeNull();
  });
});

describe('the steps', () => {
  test('full: Hello, then 8 cards, Open then Delete (no Switch)', () => {
    expect(
      [0, 1, 2, 3, 4, 5, 6, 7, 8].map((s) =>
        runStepKind('full', asRunStep('full', s) ?? 0)
      )
    ).toEqual([
      'hello',
      'openNow',
      'findAndFit',
      'save',
      'row',
      'open',
      'delete',
      'windows',
      'twoViews',
    ]);
  });

  test('popup: the welcome, then 7 cards, with Switch', () => {
    expect(
      [0, 1, 2, 3, 4, 5, 6, 7].map((s) =>
        runStepKind('popup', asRunStep('popup', s) ?? 0)
      )
    ).toEqual([
      'welcome',
      'save',
      'row',
      'open',
      'switch',
      'delete',
      'windows',
      'fullView',
    ]);
    expect(asRunStep('popup', 8)).toBeNull();
  });

  test('Next stops at the last step; Back exists from step 2', () => {
    expect(nextRunStep('full', 7)).toBe(8);
    expect(nextRunStep('full', 8)).toBeNull();
    expect(nextRunStep('popup', 7)).toBeNull();
    expect(previousRunStep('full', 2)).toBe(1);
    expect(previousRunStep('full', 1)).toBeNull();
    expect(previousRunStep('popup', 1)).toBeNull();
  });

  test('only the session steps wait for the run’s session', () => {
    expect(
      (
        [
          'openNow',
          'findAndFit',
          'save',
          'row',
          'open',
          'switch',
          'delete',
          'windows',
          'twoViews',
          'fullView',
        ] as const
      ).filter(needsSession)
    ).toEqual(['row', 'open', 'switch', 'delete', 'windows']);
  });

  test('a new popup welcome counts its first show; nothing else counts', () => {
    expect(newRun('popup', 0).welcomeShows).toBe(1);
    expect(newRun('popup', 1).welcomeShows).toBeNull();
    expect(newRun('full', 0, 'whatsNew')).toEqual({
      view: 'full',
      step: 0,
      sessionId: null,
      hello: 'whatsNew',
      welcomeShows: null,
      ended: null,
    });
  });
});

describe('who the run is for', () => {
  const NEVER_SAVED: StoredAtOpen = { cloudConsent: 'declined' };
  const UPGRADER: StoredAtOpen = { cloudConsent: 'granted' };

  test('a never-saved 1.9 user: consent answered, nothing saved or synced, no setup, no record', () => {
    expect(isNeverSaved19User(NEVER_SAVED, 0)).toBe(true);
    expect(isNeverSaved19User({ cloudConsent: '' }, 0)).toBe(false);
    expect(isNeverSaved19User(NEVER_SAVED, 1)).toBe(false);
    expect(isNeverSaved19User({ ...NEVER_SAVED, lastSyncedTime: 5 }, 0)).toBe(
      false
    );
    expect(
      isNeverSaved19User({ ...NEVER_SAVED, setupState: 'pending' }, 0)
    ).toBe(false);
    expect(
      isNeverSaved19User({ ...NEVER_SAVED, isWhatsNew2Seen: true }, 0)
    ).toBe(false);
    expect(
      isNeverSaved19User(
        { ...NEVER_SAVED, firstRun: { ...FULL_AT_3, ended: 'skipped' } },
        0
      )
    ).toBe(false);
  });

  test('R1, R13: a popup run already seen in the full view is left to its own view', async () => {
    const stored = {
      setupState: 'pending',
      hasOpenedFullView: true,
      firstRun: newRun('popup', 4),
    };
    expect(await runAtOpen('full', stored, 1, free)).toEqual({
      action: 'nothing',
      check: 'otherView',
    });
  });

  test('an upgrader: sessions or a past sync, no setup, no record, not seen', () => {
    expect(isUpgrader(UPGRADER, 2)).toBe(true);
    expect(isUpgrader({ lastSyncedTime: 5 }, 0)).toBe(true);
    expect(isUpgrader(UPGRADER, 0)).toBe(false);
    expect(isUpgrader({ ...UPGRADER, setupState: 'done' }, 2)).toBe(false);
    expect(isUpgrader({ ...UPGRADER, isWhatsNew2Seen: true }, 2)).toBe(false);
    expect(isUpgrader({ ...UPGRADER, firstRun: FULL_AT_3 }, 2)).toBe(false);
  });

  test('R13: a 2.0 install’s first full-view visit, unless a full-view run is recorded', () => {
    expect(isFirstFullViewVisit({ setupState: 'pending' })).toBe(true);
    expect(isFirstFullViewVisit({ setupState: 'done' })).toBe(true);
    expect(isFirstFullViewVisit({ setupState: 'none' })).toBe(false);
    expect(
      isFirstFullViewVisit({ setupState: 'pending', hasOpenedFullView: true })
    ).toBe(false);
    expect(
      isFirstFullViewVisit({
        setupState: 'pending',
        firstRun: { ...newRun('popup', 4), ended: 'finished' },
      })
    ).toBe(true);
    expect(
      isFirstFullViewVisit({
        setupState: 'pending',
        firstRun: { ...FULL_AT_3, ended: 'skipped' },
      })
    ).toBe(false);
  });
});

describe('runAtOpen', () => {
  test('a running record of this view: the lock decides', async () => {
    const stored = { firstRun: FULL_AT_3 };
    expect(await runAtOpen('full', stored, 0, held)).toEqual({
      action: 'nothing',
      check: 'elsewhere',
    });
    expect(await runAtOpen('full', stored, 0, unknown)).toEqual({
      action: 'nothing',
      check: 'unknown',
    });
    expect(await runAtOpen('full', stored, 0, free)).toEqual({
      action: 'resume',
      check: 'resumed',
    });
  });

  test('the lock is not asked about another view’s run (R1)', async () => {
    const lock = vi.fn(free);
    expect(await runAtOpen('popup', { firstRun: FULL_AT_3 }, 0, lock)).toEqual({
      action: 'nothing',
      check: 'otherView',
    });
    expect(lock).not.toHaveBeenCalled();
  });

  test('Q7: the welcome closed once shows again; closed twice it ends', async () => {
    expect(
      await runAtOpen('popup', { firstRun: newRun('popup', 0) }, 0, free)
    ).toEqual({ action: 'reshowWelcome', check: 'reshown' });
    expect(
      await runAtOpen(
        'popup',
        { firstRun: { ...newRun('popup', 0), welcomeShows: 2 } },
        0,
        free
      )
    ).toEqual({ action: 'endUnanswered', check: 'unanswered' });
  });

  test('R13: the full view replaces a running popup run on its first visit, at step 1 (the welcome was its hello)', async () => {
    expect(
      await runAtOpen(
        'full',
        { setupState: 'pending', firstRun: newRun('popup', 4) },
        1,
        free
      )
    ).toEqual({
      action: 'start',
      check: 'started',
      run: newRun('full', 1),
      beginsSetup: false,
    });
  });

  test.each([
    ['ended unanswered', { ...newRun('popup', 0), ended: 'unanswered' }],
    ['finished', { ...newRun('popup', 7), ended: 'finished' }],
  ])(
    'R13: a popup welcome %s was seen, so the first full-view visit starts at step 1',
    async (_name, firstRun) => {
      expect(
        await runAtOpen('full', { setupState: 'pending', firstRun }, 0, free)
      ).toEqual({
        action: 'start',
        check: 'started',
        run: newRun('full', 1),
        beginsSetup: false,
      });
    }
  );

  test('R13: setup begun with no record never saw the welcome, so its first full-view visit gets Hello', async () => {
    expect(await runAtOpen('full', { setupState: 'pending' }, 0, free)).toEqual(
      {
        action: 'start',
        check: 'started',
        run: newRun('full', 0, 'welcome'),
        beginsSetup: false,
      }
    );
  });

  test('an upgrader’s full view starts What’s new; their popup starts nothing', async () => {
    expect(
      await runAtOpen('full', { cloudConsent: 'granted' }, 3, free)
    ).toEqual({
      action: 'start',
      check: 'started',
      run: newRun('full', 0, 'whatsNew'),
      beginsSetup: false,
    });
    expect(
      await runAtOpen('popup', { cloudConsent: 'granted' }, 3, free)
    ).toEqual({ action: 'nothing', check: 'none' });
  });

  test('Q8: a never-saved 1.9 user gets the new-install start in either view, and setup begins', async () => {
    const stored = { cloudConsent: 'granted' };
    expect(await runAtOpen('full', stored, 0, free)).toEqual({
      action: 'start',
      check: 'started',
      run: newRun('full', 0, 'welcome'),
      beginsSetup: true,
    });
    expect(await runAtOpen('popup', stored, 0, free)).toEqual({
      action: 'start',
      check: 'started',
      run: newRun('popup', 0),
      beginsSetup: true,
    });
  });

  test('an ended record starts nothing, and says so', async () => {
    const stored = {
      cloudConsent: 'granted',
      setupState: 'done',
      firstRun: { ...FULL_AT_3, ended: 'finished' },
    };
    expect(await runAtOpen('full', stored, 2, free)).toEqual({
      action: 'nothing',
      check: 'ended',
    });
  });

  test('the e2e profile (seen, setup none) starts nothing in either view', async () => {
    const stored = { cloudConsent: 'granted', isWhatsNew2Seen: true };
    expect(await runAtOpen('full', stored, 5, free)).toEqual({
      action: 'nothing',
      check: 'none',
    });
    expect(await runAtOpen('popup', stored, 0, free)).toEqual({
      action: 'nothing',
      check: 'none',
    });
  });
});

describe('latestSession and the settled list', () => {
  test('the largest createdInstant wins, whatever the list order', () => {
    const old = buildSession({ title: 'Old', createdAt: 1000 });
    const newest = buildSession({ title: 'Newest', createdAt: 3000 });
    const mid = buildSession({ title: 'Mid', createdAt: 2000 });
    expect(latestSession([old, newest, mid])?.title).toBe('Newest');
    expect(latestSession([])).toBeUndefined();
  });

  test('settled: loaded, or nothing on disk to load', () => {
    expect(isSessionListSettled(false, 3)).toBe(true);
    expect(isSessionListSettled(true, 0)).toBe(true);
    expect(isSessionListSettled(true, 3)).toBe(false);
  });
});
