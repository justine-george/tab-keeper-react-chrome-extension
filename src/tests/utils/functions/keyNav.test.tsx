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

// KAN-685. In a text field the arrows, Home and End move the caret, not focus:
// a rename that used them ended with the title's ring. They count only when a
// handler moves focus out on them (the search field's ArrowDown to a result).
describe('caret keys in a text field (KAN-685)', () => {
  const CARET_KEYS = [
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Home',
    'End',
  ];
  const mount = <E extends HTMLElement>(el: E): E => {
    document.body.append(el);
    el.focus();
    return el;
  };
  const keyOn = (el: HTMLElement, k: string) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  const input = (type: string) => {
    const el = document.createElement('input');
    el.type = type;
    return el;
  };

  test.each(CARET_KEYS)('%s in a text field does not start it', (k) => {
    undo = trackKeyNav(window);
    const field = mount(input('text'));

    keyOn(field, k);

    expect(navigating()).toBe(false);
  });

  test.each(['search', 'url', 'email', 'tel', 'password'])(
    'ArrowLeft in a %s field does not start it',
    (type) => {
      undo = trackKeyNav(window);
      keyOn(mount(input(type)), 'ArrowLeft');
      expect(navigating()).toBe(false);
    }
  );

  test('ArrowLeft in a textarea does not start it', () => {
    undo = trackKeyNav(window);
    keyOn(mount(document.createElement('textarea')), 'ArrowLeft');
    expect(navigating()).toBe(false);
  });

  test('Tab in a text field starts it', () => {
    undo = trackKeyNav(window);
    keyOn(mount(input('text')), 'Tab');
    expect(navigating()).toBe(true);
  });

  test('ArrowDown in a field whose handler moves focus out starts it', () => {
    undo = trackKeyNav(window);
    const field = mount(input('search'));
    const result = document.createElement('button');
    document.body.append(result);
    field.addEventListener('keydown', () => result.focus());

    keyOn(field, 'ArrowDown');

    expect(document.activeElement).toBe(result);
    expect(navigating()).toBe(true);
  });

  // A radio group moves focus on the arrows: navigation, not a caret.
  test('ArrowDown on a radio starts it', () => {
    undo = trackKeyNav(window);
    keyOn(mount(input('radio')), 'ArrowDown');
    expect(navigating()).toBe(true);
  });

  test('a focus move after the caret key is released does not start it', () => {
    undo = trackKeyNav(window);
    const field = mount(input('text'));
    const other = document.createElement('button');
    document.body.append(other);
    keyOn(field, 'ArrowLeft');
    field.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true })
    );

    other.focus();

    expect(navigating()).toBe(false);
  });

  // A rename: ArrowLeft, then at once Enter, which hands focus to the title.
  // Chrome runs the next key before a timer, so the caret key's turn ends at it.
  test('a caret key, then another key that moves focus, does not start it', () => {
    undo = trackKeyNav(window);
    const field = mount(input('text'));
    const title = document.createElement('button');
    document.body.append(title);
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') title.focus();
    });

    keyOn(field, 'ArrowLeft');
    keyOn(field, 'Enter');

    expect(document.activeElement).toBe(title);
    expect(navigating()).toBe(false);
  });

  // An arrow still held when a click focuses something: the click wins.
  test('a press during a held caret key, and the focus it moves, do not start it', () => {
    undo = trackKeyNav(window);
    const field = mount(input('text'));
    const other = document.createElement('button');
    document.body.append(other);
    keyOn(field, 'ArrowLeft');

    press();
    other.focus();

    expect(navigating()).toBe(false);
  });

  test('a caret key in a field does not end it', () => {
    undo = trackKeyNav(window);
    const field = mount(input('text'));
    keyOn(field, 'Tab');

    keyOn(field, 'ArrowLeft');

    expect(navigating()).toBe(true);
  });
});
