import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  NEW_FIRST_WINDOW,
  NEW_LAST_WINDOW,
  markNewWindowTarget,
} from '../../components/home/rightpane/newWindowTarget';

// KAN-361. A drag area's onLandingWindowChange lights the one New window
// target its landing names and unlights every other, each found in the
// document by its value: `first` in the session header, outside the list,
// and `last`, the list's trailing block (KAN-366).

let list: HTMLElement;

const lit = () => ({
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
      <div data-drop-window-id="w1"></div>
      <div data-drop-window-id="${NEW_LAST_WINDOW}" data-new-window-target="last"></div>
    </div>
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
    [NEW_FIRST_WINDOW, { first: true, last: false }],
    [NEW_LAST_WINDOW, { first: false, last: true }],
  ])('a landing in %s lights that target alone', (windowId, expected) => {
    markNewWindowTarget(windowId, list);
    expect(lit()).toEqual(expected);
  });

  test('moving from one target to another unlights the first', () => {
    markNewWindowTarget(NEW_LAST_WINDOW, list);
    markNewWindowTarget(NEW_FIRST_WINDOW, list);
    expect(lit()).toEqual({ first: true, last: false });
  });

  test.each([
    ['a stored window', 'w1'],
    ['no landing', undefined],
  ])('%s unlights every target', (_what, windowId) => {
    // Both lit, as no landing ever leaves them, so each is shown to go.
    for (const el of document.querySelectorAll('[data-new-window-target]')) {
      el.setAttribute('data-landing', '');
    }
    // PREMISE: both are found, and lit.
    expect(lit()).toEqual({ first: true, last: true });
    markNewWindowTarget(windowId, list);
    expect(lit()).toEqual({ first: false, last: false });
  });
});
