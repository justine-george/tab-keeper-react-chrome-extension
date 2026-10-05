import { describe, expect, test } from 'vitest';

import {
  asSampleTour,
  asTourStep,
  nextTourStep,
  stepWasDone,
  tourSnapshot,
} from '../../../utils/functions/sampleTour';
import { buildSampleSession } from '../../../utils/functions/sampleSession';

// KAN-413. The tour's record, and what counts as doing each step.

const NAMES = {
  title: 'Sample: Weekend trip',
  gettingThere: 'Getting there',
  thingsToDo: 'Things to do',
};
const counter = () => {
  let n = 0;
  return () => `id-${++n}`;
};
const SAMPLE = buildSampleSession(
  NAMES,
  new Date(2026, 9, 4, 9, 30, 0),
  counter()
);
const [W1, W2] = SAMPLE.windows;
const BEFORE = tourSnapshot(SAMPLE, []);

const renamed = { ...SAMPLE, title: 'Lisbon in May' };
const reordered = {
  ...SAMPLE,
  windows: [{ ...W1, tabs: [W1.tabs[1], W1.tabs[0], W1.tabs[2]] }, W2],
};
const movedAcross = {
  ...SAMPLE,
  windows: [
    { ...W1, tabs: W1.tabs.slice(1), tabCount: 2 },
    { ...W2, tabs: [W1.tabs[0], ...W2.tabs], tabCount: 3 },
  ],
};
const leftTheSample = {
  ...SAMPLE,
  windows: [{ ...W1, tabs: W1.tabs.slice(1), tabCount: 2 }, W2],
};

describe('asSampleTour', () => {
  test('keeps a valid record', () => {
    expect(
      asSampleTour({ sampleId: 'sample:a', step: 3, view: 'full' })
    ).toEqual({ sampleId: 'sample:a', step: 3, view: 'full' });
  });

  test('keeps only the fields it knows', () => {
    expect(
      asSampleTour({ sampleId: 'sample:a', step: 1, view: 'popup', extra: 1 })
    ).toEqual({ sampleId: 'sample:a', step: 1, view: 'popup' });
  });

  test.each([
    ['null', null],
    ['an array', [1]],
    ['a string', 'sample:a'],
    ['no id', { step: 1, view: 'popup' }],
    ['an id that is not a sample', { sampleId: 'abc', step: 1, view: 'popup' }],
    ['step 0', { sampleId: 'sample:a', step: 0, view: 'popup' }],
    ['step 6', { sampleId: 'sample:a', step: 6, view: 'popup' }],
    ['a step as text', { sampleId: 'sample:a', step: '2', view: 'popup' }],
    ['another view', { sampleId: 'sample:a', step: 2, view: 'tab' }],
  ])('reads %s as no tour', (_name, value) => {
    expect(asSampleTour(value)).toBeNull();
  });
});

describe('the step order', () => {
  test('asTourStep keeps 1 to 5 and nothing else', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 2.5].map(asTourStep)).toEqual([
      null,
      1,
      2,
      3,
      4,
      5,
      null,
      null,
    ]);
  });

  test('each step leads to the next, and step 5 to none', () => {
    expect(([1, 2, 3, 4, 5] as const).map(nextTourStep)).toEqual([
      2,
      3,
      4,
      5,
      null,
    ]);
  });
});

describe('stepWasDone', () => {
  test.each([
    ['step 1: a window folds', 1, tourSnapshot(SAMPLE, [W2.windowId]), true],
    ['step 1: a rename is not it', 1, tourSnapshot(renamed, []), false],
    ['step 2 is Next only', 2, tourSnapshot(renamed, [W1.windowId]), false],
    ['step 3: the title changes', 3, tourSnapshot(renamed, []), true],
    ['step 3: a fold is not it', 3, tourSnapshot(SAMPLE, [W1.windowId]), false],
    ['step 4: a tab reorders', 4, tourSnapshot(reordered, []), true],
    [
      'step 4: a tab moves to the other window',
      4,
      tourSnapshot(movedAcross, []),
      true,
    ],
    [
      'step 4: a tab leaves the sample',
      4,
      tourSnapshot(leftTheSample, []),
      true,
    ],
    ['step 4: a rename is not it', 4, tourSnapshot(renamed, []), false],
    [
      'step 5 never moves on its own',
      5,
      tourSnapshot(leftTheSample, [W1.windowId]),
      false,
    ],
  ] as const)('%s', (_name, step, now, done) => {
    expect(stepWasDone(step, BEFORE, now)).toBe(done);
  });

  test('step 1: unfolding counts too', () => {
    expect(stepWasDone(1, tourSnapshot(SAMPLE, [W2.windowId]), BEFORE)).toBe(
      true
    );
  });

  test('folds compare as a set, not in the order they were folded', () => {
    expect(
      stepWasDone(
        1,
        tourSnapshot(SAMPLE, [W1.windowId, W2.windowId]),
        tourSnapshot(SAMPLE, [W2.windowId, W1.windowId])
      )
    ).toBe(false);
  });

  test('nothing changed is no step done', () => {
    for (const step of [1, 2, 3, 4, 5] as const) {
      expect(stepWasDone(step, BEFORE, tourSnapshot(SAMPLE, []))).toBe(false);
    }
  });
});
