import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  NEW_FIRST_WINDOW,
  NEW_LAST_WINDOW,
  markNewWindowTarget,
} from '../../components/home/rightpane/newWindowTarget';
import { CARRY_NEW_WINDOW_ID } from '../../utils/functions/carriedView';

// KAN-361. A drag area's onLandingWindowChange lights the one New window
// target its landing names and unlights every other: the carry's synthetic
// window (`data-new-window-target=""`), found inside the list, and the ones
// that name a new window, found in the document by their value -- `first`
// in the session header, `last` (KAN-366) at the list's end. Here `last` is
// placed outside the list, so the test also shows it is not looked for
// inside it alone.

let list: HTMLElement;

const lit = () => ({
  inList: list
    .querySelector('[data-new-window-target=""]')
    ?.hasAttribute('data-landing'),
  first: document
    .querySelector('[data-new-window-target="first"]')
    ?.hasAttribute('data-landing'),
  last: document
    .querySelector('[data-new-window-target="last"]')
    ?.hasAttribute('data-landing'),
});

beforeEach(() => {
  document.body.innerHTML = `
    <div data-session-toolbar>
      <div data-new-window-target="first"></div>
    </div>
    <div id="list">
      <div data-drop-window-id="${CARRY_NEW_WINDOW_ID}" data-new-window-target=""></div>
      <div data-drop-window-id="w1"></div>
    </div>
    <div data-new-window-target="last"></div>
  `;
  const el = document.getElementById('list');
  if (el === null) throw new Error('no list');
  list = el;
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('markNewWindowTarget', () => {
  test.each([
    [NEW_FIRST_WINDOW, { inList: false, first: true, last: false }],
    [NEW_LAST_WINDOW, { inList: false, first: false, last: true }],
    [CARRY_NEW_WINDOW_ID, { inList: true, first: false, last: false }],
  ])('a landing in %s lights that target alone', (windowId, expected) => {
    markNewWindowTarget(windowId, list);
    expect(lit()).toEqual(expected);
  });

  test('moving from one target to another unlights the first', () => {
    markNewWindowTarget(CARRY_NEW_WINDOW_ID, list);
    markNewWindowTarget(NEW_FIRST_WINDOW, list);
    expect(lit()).toEqual({ inList: false, first: true, last: false });
  });

  test.each([
    ['a stored window', 'w1'],
    ['no landing', undefined],
  ])('%s unlights every target', (_what, windowId) => {
    markNewWindowTarget(NEW_FIRST_WINDOW, list);
    markNewWindowTarget(CARRY_NEW_WINDOW_ID, list);
    markNewWindowTarget(windowId, list);
    expect(lit()).toEqual({ inList: false, first: false, last: false });
  });
});
