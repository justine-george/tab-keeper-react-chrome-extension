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
  newFullViewStepsRun,
  newRun,
  nextRunStep,
  pinCardFor,
  previousRunStep,
  runAtOpen,
  runProgress,
  runSteps,
  runStepKind,
  stepKindOf,
  type FirstRun,
  type RunStep,
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

  test.each([1, 2, 3, 4, 5])(
    'keeps the popup welcome with its show count of %i',
    (welcomeShows) => {
      expect(asFirstRun({ ...newRun('popup', 0), welcomeShows })).toEqual({
        ...newRun('popup', 0),
        welcomeShows,
      });
    }
  );

  test.each([
    ['null', null],
    ['an array', [FULL_AT_3]],
    ['another view', { ...FULL_AT_3, view: 'tab' }],
    ['full step 10', { ...FULL_AT_3, step: 10 }],
    ['popup step 9', { ...newRun('popup', 1), step: 9 }],
    ['a step as text', { ...FULL_AT_3, step: '3' }],
    ['a numeric session id', { ...FULL_AT_3, sessionId: 7 }],
    ['another hello', { ...FULL_AT_3, hello: 'hi' }],
    ['another ending', { ...FULL_AT_3, ended: 'done' }],
    [
      'the popup welcome with no count',
      { ...newRun('popup', 0), welcomeShows: null },
    ],
    ['a count off the welcome', { ...newRun('popup', 1), welcomeShows: 1 }],
    ['a count of 0', { ...newRun('popup', 0), welcomeShows: 0 }],
    ['a count of 6', { ...newRun('popup', 0), welcomeShows: 6 }],
    ['a count of 2.5', { ...newRun('popup', 0), welcomeShows: 2.5 }],
  ])('reads %s as no record', (_name, value) => {
    expect(asFirstRun(value)).toBeNull();
  });

  test('KAN-830: a record stored before onlyFullViewSteps reads as a whole run', () => {
    const stored: Record<string, unknown> = { ...FULL_AT_3 };
    delete stored.onlyFullViewSteps;
    expect(asFirstRun(stored)).toEqual({
      ...FULL_AT_3,
      onlyFullViewSteps: false,
    });
  });

  test('KAN-830: a short run round-trips at each of its steps, with or without the example', () => {
    const short = newFullViewStepsRun(null);
    expect(asFirstRun(short)).toEqual(short);
    expect(asFirstRun({ ...short, step: 2 })).toEqual({ ...short, step: 2 });
    expect(asFirstRun({ ...short, step: 9 })).toEqual({ ...short, step: 9 });
    const carried = newFullViewStepsRun('sample:abc');
    expect(asFirstRun(carried)).toEqual(carried);
  });

  test.each([
    [
      'onlyFullViewSteps as text',
      { ...newFullViewStepsRun(null), onlyFullViewSteps: 'yes' },
    ],
    [
      'onlyFullViewSteps on a popup record',
      { ...newRun('popup', 1), onlyFullViewSteps: true },
    ],
    ['a short run at step 3', { ...newFullViewStepsRun(null), step: 3 }],
    ['a short run at step 0', { ...newFullViewStepsRun(null), step: 0 }],
  ])('KAN-830: reads %s as no record', (_name, value) => {
    expect(asFirstRun(value)).toBeNull();
  });
});

describe('the steps', () => {
  // KAN-586: Replace after Open (full) or Switch (popup), before Delete.
  test('full: Hello, then 9 cards, Open, Replace, then Delete (no Switch)', () => {
    expect(
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((s) =>
        runStepKind('full', asRunStep('full', s) ?? 0)
      )
    ).toEqual([
      'hello',
      'openNow',
      'findAndFit',
      'save',
      'row',
      'open',
      'replace',
      'delete',
      'windows',
      'twoViews',
    ]);
  });

  test('popup: the welcome, then 8 cards, with Switch', () => {
    expect(
      [0, 1, 2, 3, 4, 5, 6, 7, 8].map((s) =>
        runStepKind('popup', asRunStep('popup', s) ?? 0)
      )
    ).toEqual([
      'welcome',
      'save',
      'row',
      'open',
      'switch',
      'replace',
      'delete',
      'windows',
      'fullView',
    ]);
    expect(asRunStep('popup', 9)).toBeNull();
    expect(asRunStep('full', 10)).toBeNull();
  });

  test('Next stops at the last step; Back exists from step 2', () => {
    expect(nextRunStep(newRun('full', 0), 'show')).toBe(1);
    expect(nextRunStep(newRun('full', 8), 'show')).toBe(9);
    expect(nextRunStep(newRun('full', 9), 'show')).toBeNull();
    expect(nextRunStep(newRun('popup', 7), 'show')).toBe(8);
    expect(nextRunStep(newRun('popup', 8), 'show')).toBeNull();
    expect(previousRunStep(newRun('full', 2), 'show')).toBe(1);
    expect(previousRunStep(newRun('full', 1), 'show')).toBeNull();
    expect(previousRunStep(newRun('popup', 1), 'show')).toBeNull();
  });

  test('KAN-830: a short run is the full view’s own steps: Currently open, Find & fit, Two views', () => {
    const steps = runSteps(newFullViewStepsRun(null), 'show');
    expect(steps).toEqual([1, 2, 9]);
    expect(steps.map((s) => runStepKind('full', s))).toEqual([
      'openNow',
      'findAndFit',
      'twoViews',
    ]);
  });

  test('KAN-830: a short run moves 1 → 2 → 9 and back; no Back on its first', () => {
    const at = (step: 1 | 2 | 9): FirstRun => ({
      ...newFullViewStepsRun(null),
      step,
    });
    expect(nextRunStep(at(1), 'show')).toBe(2);
    expect(nextRunStep(at(2), 'show')).toBe(9);
    expect(nextRunStep(at(9), 'show')).toBeNull();
    expect(previousRunStep(at(9), 'show')).toBe(2);
    expect(previousRunStep(at(2), 'show')).toBe(1);
    expect(previousRunStep(at(1), 'show')).toBeNull();
  });

  test('KAN-830: a short run counts 1, 2, 3 of 3; a whole run counts its step of 9', () => {
    const at = (step: 1 | 2 | 9): FirstRun => ({
      ...newFullViewStepsRun(null),
      step,
    });
    expect(runProgress(at(1), 'show')).toEqual({ position: 1, total: 3 });
    expect(runProgress(at(2), 'show')).toEqual({ position: 2, total: 3 });
    expect(runProgress(at(9), 'show')).toEqual({ position: 3, total: 3 });
    expect(runProgress(newRun('full', 1), 'show')).toEqual({
      position: 1,
      total: 9,
    });
    expect(runProgress(newRun('popup', 4), 'show')).toEqual({
      position: 4,
      total: 8,
    });
  });

  test('KAN-878: skipping the pin card, a whole full run is 8 cards ending on Windows', () => {
    const at = (step: RunStep) => newRun('full', step);
    expect(runSteps(at(1), 'skip')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(nextRunStep(at(7), 'skip')).toBe(8);
    expect(nextRunStep(at(8), 'skip')).toBeNull();
    expect(previousRunStep(at(8), 'skip')).toBe(7);
    expect(nextRunStep(at(0), 'skip')).toBe(1);
    expect(runProgress(at(1), 'skip')).toEqual({ position: 1, total: 8 });
    expect(runProgress(at(8), 'skip')).toEqual({ position: 8, total: 8 });
    expect(runProgress(at(8), 'show')).toEqual({ position: 8, total: 9 });
  });

  test('KAN-878: skipping the pin card, a short run is Currently open, Find & fit', () => {
    const at = (step: RunStep): FirstRun => ({
      ...newFullViewStepsRun(null),
      step,
    });
    expect(runSteps(at(1), 'skip')).toEqual([1, 2]);
    expect(nextRunStep(at(2), 'skip')).toBeNull();
    expect(previousRunStep(at(2), 'skip')).toBe(1);
    expect(runProgress(at(2), 'skip')).toEqual({ position: 2, total: 2 });
  });

  test('KAN-878: the popup run is the same either way', () => {
    const at = (step: RunStep) => newRun('popup', step);
    expect(runSteps(at(1), 'skip')).toEqual(runSteps(at(1), 'show'));
    expect(nextRunStep(at(8), 'skip')).toBeNull();
    expect(runProgress(at(8), 'skip')).toEqual({ position: 8, total: 8 });
  });

  test('KAN-878: the card is skipped only on a pinned tab that pins in new windows, and never from the card itself', () => {
    const full = newRun('full', 1);
    expect(pinCardFor(full, true, true)).toBe('skip');
    expect(pinCardFor(full, true, false)).toBe('show');
    expect(pinCardFor(full, false, true)).toBe('show');
    expect(pinCardFor(full, null, true)).toBe('show');
    expect(pinCardFor(newRun('full', 9), true, true)).toBe('show');
    expect(
      pinCardFor({ ...newFullViewStepsRun(null), step: 9 }, true, true)
    ).toBe('show');
    expect(pinCardFor(newRun('popup', 1), true, true)).toBe('show');
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
          'replace',
          'delete',
          'windows',
          'twoViews',
          'fullView',
        ] as const
      ).filter(needsSession)
    ).toEqual(['row', 'open', 'switch', 'replace', 'delete', 'windows']);
  });

  test('a new popup welcome counts its first show; nothing else counts', () => {
    expect(newRun('popup', 0).welcomeShows).toBe(1);
    expect(newRun('popup', 1).welcomeShows).toBeNull();
    expect(newRun('full', 0, 'whatsNew')).toEqual({
      view: 'full',
      step: 0,
      sessionId: null,
      hello: 'whatsNew',
      helloIn: 'full',
      welcomeShows: null,
      ended: null,
      onlyFullViewSteps: false,
      isReplay: false,
      isSessionNameTyped: false,
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

  test.each([1, 2, 3, 4])(
    'Q7: the welcome closed unanswered after %i shows shows again',
    async (welcomeShows) => {
      expect(
        await runAtOpen(
          'popup',
          { firstRun: { ...newRun('popup', 0), welcomeShows } },
          0,
          free
        )
      ).toEqual({ action: 'reshowHello', check: 'reshown', hello: 'welcome' });
    }
  );

  test.each([1, 2, 3, 4])(
    'KAN-623: the popup’s What’s new closed unanswered after %i shows shows again',
    async (welcomeShows) => {
      expect(
        await runAtOpen(
          'popup',
          { firstRun: { ...newRun('popup', 0, 'whatsNew'), welcomeShows } },
          2,
          free
        )
      ).toEqual({ action: 'reshowHello', check: 'reshown', hello: 'whatsNew' });
    }
  );

  test.each(['welcome', 'whatsNew'] as const)(
    'Q7: the open after the fifth show of the popup’s %s ends it unanswered',
    async (hello) => {
      expect(
        await runAtOpen(
          'popup',
          { firstRun: { ...newRun('popup', 0, hello), welcomeShows: 5 } },
          2,
          free
        )
      ).toEqual({ action: 'endUnanswered', check: 'unanswered' });
    }
  );

  test.each([
    ['running, no session', newRun('popup', 4), null],
    [
      'running, holding the example',
      { ...newRun('popup', 4), sessionId: 'sample:x' },
      'sample:x',
    ],
    [
      'running, holding the user’s own save',
      { ...newRun('popup', 4), sessionId: 'own' },
      null,
    ],
    [
      'finished, holding a stale example id',
      { ...newRun('popup', 7), ended: 'finished', sessionId: 'sample:x' },
      null,
    ],
    ['skipped', { ...newRun('popup', 3), ended: 'skipped' }, null],
    [
      'ended sessionGone',
      { ...newRun('popup', 5), ended: 'sessionGone' },
      null,
    ],
  ])(
    'KAN-830: a popup tour %s gives the first full-view visit the short tour',
    async (_name, firstRun, carried) => {
      expect(
        await runAtOpen('full', { setupState: 'pending', firstRun }, 1, free)
      ).toEqual({
        action: 'start',
        check: 'started',
        run: newFullViewStepsRun(carried),
        beginsSetup: false,
      });
    }
  );

  test.each([
    ['ended unanswered', { ...newRun('popup', 0), ended: 'unanswered' }],
    ['still showing', newRun('popup', 0)],
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

  test('KAN-623: an upgrader starts What’s new in either view; the popup’s is its step 0', async () => {
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
    ).toEqual({
      action: 'start',
      check: 'started',
      run: newRun('popup', 0, 'whatsNew'),
      beginsSetup: false,
    });
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

// The record as an older build stored it, with no helloIn.
const withoutHelloIn = (run: FirstRun): Record<string, unknown> =>
  Object.fromEntries(Object.entries(run).filter(([key]) => key !== 'helloIn'));

describe('KAN-623: where the run’s Hello was', () => {
  test('a record stored without helloIn started in its own view', () => {
    expect(asFirstRun(withoutHelloIn(FULL_AT_3))).toEqual(FULL_AT_3);
    expect(asFirstRun(withoutHelloIn(newRun('popup', 0)))?.helloIn).toBe(
      'popup'
    );
  });

  test('keeps a full-view record whose Hello was the popup’s', () => {
    const run = newRun('full', 0, 'whatsNew', 'popup');
    expect(run.helloIn).toBe('popup');
    expect(asFirstRun(run)).toEqual(run);
  });

  test.each([
    ['null', null],
    ['another view', 'tab'],
    ['a number', 1],
  ])('reads a helloIn of %s as no record', (_name, helloIn) => {
    expect(asFirstRun({ ...newRun('full', 0), helloIn })).toBeNull();
  });

  test('full step 0 is the compact-view card after the popup’s Hello, else the Hello', () => {
    expect(stepKindOf(newRun('full', 0, 'whatsNew', 'popup'))).toBe(
      'compactView'
    );
    expect(stepKindOf(newRun('full', 0, 'welcome', 'popup'))).toBe(
      'compactView'
    );
    expect(stepKindOf(newRun('full', 0, 'whatsNew'))).toBe('hello');
    expect(stepKindOf(newRun('full', 1, 'whatsNew', 'popup'))).toBe('openNow');
    expect(stepKindOf(newRun('popup', 0, 'whatsNew'))).toBe('welcome');
  });

  test('the card waits for no session, and Back never reaches it', () => {
    expect(needsSession('compactView')).toBe(false);
    expect(previousRunStep(newRun('full', 1), 'show')).toBeNull();
  });
});
