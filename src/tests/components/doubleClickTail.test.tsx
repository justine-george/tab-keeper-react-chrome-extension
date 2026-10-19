import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Mock } from 'vitest';
import { fireEvent } from '@testing-library/react';

import { holdBackDoubleClickTail } from '../../components/common/doubleClickTail';

// KAN-696. A .tsx file for its jsdom project (a .ts test runs under node). A menu item closes its menu on the first click of a double-click,
// so the second click lands on whatever slid under the pointer. The tail is
// held back until the next fresh press or key.

let button: HTMLButtonElement;
let onClick: Mock<(event: Event) => void>;

beforeEach(() => {
  button = document.createElement('button');
  onClick = vi.fn<(event: Event) => void>();
  button.addEventListener('click', onClick);
  document.body.append(button);
});

// Ends any tail a test left held, so the next test starts clean.
afterEach(() => {
  fireEvent.keyDown(document.body, { key: 'a' });
  button.remove();
});

describe('holdBackDoubleClickTail', () => {
  test('a click with a count past 1 does not reach its target', () => {
    holdBackDoubleClickTail();
    fireEvent.click(button, { detail: 2 });
    expect(onClick).not.toHaveBeenCalled();
  });

  test('the whole tail is held: mousedown, mouseup, click and dblclick', () => {
    holdBackDoubleClickTail();
    const reached = vi.fn<(event: Event) => void>();
    for (const type of ['mousedown', 'mouseup', 'click', 'dblclick']) {
      button.addEventListener(type, reached);
      fireEvent(
        button,
        new MouseEvent(type, { bubbles: true, cancelable: true, detail: 2 })
      );
    }
    expect(reached).not.toHaveBeenCalled();
  });

  test('a first click is not held back', () => {
    holdBackDoubleClickTail();
    fireEvent.click(button, { detail: 1 });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('a fresh press removes the hold, so a later count past 1 reaches its target', () => {
    holdBackDoubleClickTail();
    fireEvent.mouseDown(button, { detail: 1 });
    fireEvent.click(button, { detail: 2 });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('a key removes the hold', () => {
    holdBackDoubleClickTail();
    fireEvent.keyDown(document.body, { key: 'Enter' });
    fireEvent.click(button, { detail: 2 });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('no timer ends it: the hold outlasts any wait', () => {
    vi.useFakeTimers();
    try {
      holdBackDoubleClickTail();
      vi.advanceTimersByTime(60_000);
      fireEvent.click(button, { detail: 2 });
      expect(onClick).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test('called twice, it still takes one press to end it', () => {
    holdBackDoubleClickTail();
    holdBackDoubleClickTail();
    fireEvent.mouseDown(button, { detail: 1 });
    fireEvent.click(button, { detail: 2 });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
