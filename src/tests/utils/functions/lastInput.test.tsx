import { afterEach, describe, expect, test } from 'vitest';

import { lastInputWasKey, trackLastInput } from '../../../utils/functions/lastInput';

describe('the last input, a key or a press (KAN-982)', () => {
  let undo: () => void = () => {};
  afterEach(() => undo());

  const key = (k: string) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
  const press = () => window.dispatchEvent(new Event('pointerdown'));

  test('any key makes it a key, any press a press, whichever came last', () => {
    undo = trackLastInput(window);
    press();
    expect(lastInputWasKey()).toBe(false);
    key('Enter');
    expect(lastInputWasKey()).toBe(true);
    press();
    expect(lastInputWasKey()).toBe(false);
    key('Escape');
    expect(lastInputWasKey()).toBe(true);
  });

  test('a key a handler stops still counts: it listens capturing', () => {
    undo = trackLastInput(window);
    press();
    const stop = (e: Event) => e.stopPropagation();
    document.body.addEventListener('keydown', stop);
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true })
    );
    document.body.removeEventListener('keydown', stop);
    expect(lastInputWasKey()).toBe(true);
  });

  test('before any input, and after the undo, it reads as a press', () => {
    undo = trackLastInput(window);
    key('Enter');
    undo();
    expect(lastInputWasKey()).toBe(false);
    key('Enter');
    expect(lastInputWasKey()).toBe(false);
  });
});
