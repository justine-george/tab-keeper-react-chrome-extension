import { afterEach, describe, expect, test } from 'vitest';

import {
  KEY_NAV_ATTRIBUTE,
  trackKeyNav,
} from '../../../utils/functions/keyNav';

// KAN-689. `.tsx` for the jsdom project: it needs a real window and document
// (see viewMode.test.tsx). The rings it gates are e2e/key-nav-ring.spec.ts.

let undo: (() => void) | undefined;

afterEach(() => {
  undo?.();
  undo = undefined;
  document.documentElement.removeAttribute(KEY_NAV_ATTRIBUTE);
  document.body.replaceChildren();
});

const navigating = () =>
  document.documentElement.hasAttribute(KEY_NAV_ATTRIBUTE);
const key = (k: string, init: KeyboardEventInit = {}) =>
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, ...init })
  );
const press = () =>
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));

describe('trackKeyNav', () => {
  test.each([
    'Tab',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Home',
    'End',
  ])('%s starts keyboard navigation', (k) => {
    undo = trackKeyNav(window);
    expect(navigating()).toBe(false);

    key(k);

    expect(navigating()).toBe(true);
  });

  test('Shift+Tab starts it', () => {
    undo = trackKeyNav(window);
    key('Tab', { shiftKey: true });
    expect(navigating()).toBe(true);
  });

  test('a pointer press ends it', () => {
    undo = trackKeyNav(window);
    key('Tab');

    press();

    expect(navigating()).toBe(false);
  });

  const OTHER_KEYS = [
    'Delete',
    'Backspace',
    'Enter',
    'Escape',
    ' ',
    'a',
    'Shift',
  ];

  test.each(OTHER_KEYS)('%s does not start it', (k) => {
    undo = trackKeyNav(window);
    key(k);
    expect(navigating()).toBe(false);
  });

  // A keyboard user who deletes a row keeps the ring on the next one.
  test.each(OTHER_KEYS)('%s does not end it', (k) => {
    undo = trackKeyNav(window);
    key('Tab');
    key(k);
    expect(navigating()).toBe(true);
  });

  test('a handler that stops the key does not hide it', () => {
    undo = trackKeyNav(window);
    const field = document.createElement('input');
    document.body.append(field);
    field.addEventListener('keydown', (e) => e.stopPropagation());

    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
    );

    expect(navigating()).toBe(true);
  });

  test('the undo stops tracking', () => {
    trackKeyNav(window)();
    key('Tab');
    expect(navigating()).toBe(false);
  });
});
