import { describe, expect, test } from 'vitest';

import en from '../../../public/locales/en/translation.json';

// The app does two things to the current window and they are not the same
// thing:
//
//   SAVE  -- left pane. Creates a NEW session out of what is open.
//   ADD   -- right pane. Puts the current window into the session already
//            selected, changing an existing session.
//
// They must not share a verb. They did: `t('Add window')` rendered "Save this
// window" and `t('Add current window')` rendered "Save current window", so the
// most prominent labelled control on the screen invited a first-time user to
// "save" via the operation that only edits an existing session. The two
// tooltips then differed only by a trailing "as a session", in all ten
// locales.
//
// Note where the drift lived: the KEYS said "Add" the whole time. Only the
// translations said "Save", so no compiler and no render test could see it --
// the code and the screen disagreed about the verb. That is what this file
// exists to catch, and it is why the assertion is on the *values*.
const ADD_OPERATIONS = [
  'Add window',
  'Add current window',
  'Add current tab',
  'Current window added to this session.',
  'Current tab added to this window.',
];

const SAVE_OPERATIONS = [
  'Save every open window as a session',
  'Save current window as a session',
  'All open windows saved as a session.',
  'Current window saved as a session.',
];

const strings = en as Record<string, string>;

describe('Save and Add are different verbs', () => {
  test('no add-operation string calls itself a save', () => {
    const offenders = ADD_OPERATIONS.filter(
      (key) => strings[key]?.toLowerCase().includes('save')
    ).map((key) => `${key} -> ${strings[key]}`);

    expect(offenders).toEqual([]);
  });

  // The control. Without it the test above passes trivially if the save
  // strings are also stripped of the word, or if a key is simply missing.
  test('every save-operation string does say save', () => {
    const offenders = SAVE_OPERATIONS.filter(
      (key) => !strings[key]?.toLowerCase().includes('save')
    ).map((key) => `${key} -> ${strings[key]}`);

    expect(offenders).toEqual([]);
  });

  test('every key checked here exists in the en locale', () => {
    const missing = [...ADD_OPERATIONS, ...SAVE_OPERATIONS].filter(
      (key) => typeof strings[key] !== 'string'
    );

    expect(missing).toEqual([]);
  });
});
