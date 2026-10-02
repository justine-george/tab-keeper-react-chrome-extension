import { afterEach, describe, expect, test } from 'vitest';

import { isSearchShortcut } from '../../components/common/searchShortcut';
import { beginDragHold, endDragHold } from '../../redux/dragHold';

afterEach(() => {
  document.body.innerHTML = '';
  endDragHold();
});

function keydownOn(target: Element, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

// The event is inspected as it reaches window, as the hook sees it.
function judged(target: Element, init: KeyboardEventInit): boolean {
  let verdict = false;
  const listener = (event: KeyboardEvent) => {
    verdict = isSearchShortcut(event);
  };
  window.addEventListener('keydown', listener);
  keydownOn(target, init);
  window.removeEventListener('keydown', listener);
  return verdict;
}

describe('isSearchShortcut (KAN-330 O14b)', () => {
  test('a plain / on the page is the shortcut', () => {
    expect(judged(document.body, { key: '/' })).toBe(true);
  });
  test('a / typed on a German layout (Shift+7) still is', () => {
    expect(judged(document.body, { key: '/', shiftKey: true })).toBe(true);
  });
  test.each([
    [
      'in an input',
      () => document.body.appendChild(document.createElement('input')),
    ],
    [
      'in a textarea',
      () => document.body.appendChild(document.createElement('textarea')),
    ],
    [
      'in a contenteditable',
      () => {
        const d = document.createElement('div');
        d.setAttribute('contenteditable', '');
        return document.body.appendChild(d);
      },
    ],
  ])('not %s', (_name, make) => {
    expect(judged(make(), { key: '/' })).toBe(false);
  });
  test.each([['metaKey'], ['ctrlKey'], ['altKey']])(
    'not with %s',
    (modifier) => {
      expect(judged(document.body, { key: '/', [modifier]: true })).toBe(false);
    }
  );
  test('not on a key repeat', () => {
    expect(judged(document.body, { key: '/', repeat: true })).toBe(false);
  });
  test('not while a <dialog> is open', () => {
    const dialog = document.body.appendChild(document.createElement('dialog'));
    dialog.setAttribute('open', '');
    expect(judged(document.body, { key: '/' })).toBe(false);
  });
  test('not while a row is held (D12)', () => {
    beginDragHold();
    expect(judged(document.body, { key: '/' })).toBe(false);
  });
  test('not another key', () => {
    expect(judged(document.body, { key: '?' })).toBe(false);
  });
});
