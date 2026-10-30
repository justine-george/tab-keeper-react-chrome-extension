import type { TFunction } from 'i18next';
import { beforeAll, describe, expect, test } from 'vitest';

import type { tabContainerData } from '../../redux/slices/tabContainerDataStateSlice';
import { newRun } from '../../utils/functions/firstRun';
import {
  endingLines,
  endingTarget,
} from '../../utils/functions/onboardingEnding';
import { SAMPLE_ID_PREFIX } from '../../utils/functions/sampleSession';
import { tFor } from '../setup/localeT';

// KAN-879. Who the tour's ending card points at, and the three lines it says.

function session(tabGroupId: string, createdAt: number): tabContainerData {
  return {
    tabGroupId,
    createdTime: '',
    createdAt,
    title: tabGroupId,
    windowCount: 0,
    tabCount: 0,
    isAutoSave: false,
    isSelected: false,
    windows: [],
  };
}

function runHolding(sessionId: string | null, isTyped: boolean) {
  return {
    ...newRun('full', 1),
    sessionId,
    isSessionNameTyped: isTyped,
  };
}

// English keys are the English text, so real en reads as the identity.
let identity: TFunction;
beforeAll(async () => {
  identity = await tFor('en');
});

describe('endingTarget', () => {
  const sessions = [
    session('old', 100),
    session('new', 300),
    session('mid', 200),
  ];

  test('points at the session the run holds, with its typed flag', () => {
    expect(endingTarget(runHolding('mid', true), sessions)).toEqual({
      kind: 'session',
      sessionId: 'mid',
      isNameTyped: true,
    });
    expect(endingTarget(runHolding('mid', false), sessions)).toEqual({
      kind: 'session',
      sessionId: 'mid',
      isNameTyped: false,
    });
  });

  test('falls to the newest session when the run session is gone', () => {
    expect(endingTarget(runHolding('gone', true), sessions)).toEqual({
      kind: 'session',
      sessionId: 'new',
      isNameTyped: false,
    });
  });

  test('falls to the newest session when the run holds none or is null', () => {
    const expected = { kind: 'session', sessionId: 'new', isNameTyped: false };
    expect(endingTarget(runHolding(null, false), sessions)).toEqual(expected);
    expect(endingTarget(null, sessions)).toEqual(expected);
  });

  test('never points at the example, even when the run holds it', () => {
    const example = session(`${SAMPLE_ID_PREFIX}one`, 999);
    expect(
      endingTarget(runHolding(example.tabGroupId, true), [example, ...sessions])
    ).toEqual({ kind: 'session', sessionId: 'new', isNameTyped: false });
  });

  test('saves when there is no session, or only the example', () => {
    expect(endingTarget(runHolding('x', true), [])).toEqual({ kind: 'save' });
    expect(endingTarget(null, [session(`${SAMPLE_ID_PREFIX}one`, 1)])).toEqual({
      kind: 'save',
    });
  });
});

describe('endingLines', () => {
  test('typed name', () => {
    expect(
      endingLines(
        { kind: 'session', sessionId: 'a', isNameTyped: true },
        'Lisbon trip',
        identity
      )
    ).toEqual([
      "You're all set. Lisbon trip is saved.",
      'Open brings its tabs back, any time.',
      'Have a good day!',
    ]);
  });

  test('name not typed', () => {
    expect(
      endingLines(
        { kind: 'session', sessionId: 'a', isNameTyped: false },
        'Whatever',
        identity
      )
    ).toEqual([
      "You're all set. Your tabs are saved here.",
      'Open brings them back, any time.',
      'Have a good day!',
    ]);
  });

  test('no session', () => {
    expect(endingLines({ kind: 'save' }, '', identity)).toEqual([
      "You're all set.",
      'Save your tabs here whenever you like.',
      'Have a good day!',
    ]);
  });
});

describe('endingLines in another language', () => {
  test('the typed line keeps the name inside the translation', async () => {
    const de = await tFor('de');
    const [first] = endingLines(
      { kind: 'session', sessionId: 'a', isNameTyped: true },
      'Lisbon trip',
      de
    );
    expect(first).toContain('Lisbon trip');
    expect(first).not.toContain('{{');
    expect(first).not.toBe("You're all set. Lisbon trip is saved.");
  });
});
