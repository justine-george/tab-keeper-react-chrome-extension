import { afterEach, describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  isSearchShortcut,
  searchPaneFor,
  type SearchPane,
} from '../../components/common/searchShortcut';
import { useSearchShortcut } from '../../hooks/useSearchShortcut';
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

describe('searchPaneFor', () => {
  test('null and the page are the saved list', () => {
    expect(searchPaneFor(null)).toBe('saved');
    expect(searchPaneFor(document.body)).toBe('saved');
  });
  test('a node inside the Open now column is Open now', () => {
    document.body.innerHTML =
      '<div data-pane="open-now"><div><button id="b"></button></div></div>';
    expect(searchPaneFor(document.getElementById('b'))).toBe('openNow');
  });
  test('another pane is the saved list', () => {
    document.body.innerHTML =
      '<div data-pane="detail"><button id="b"></button></div>';
    expect(searchPaneFor(document.getElementById('b'))).toBe('saved');
  });
});

type Handlers = Partial<Record<SearchPane, (() => void) | null>>;

function Harness({ handlers }: { handlers: Handlers }) {
  useSearchShortcut('saved', handlers.saved ?? null);
  useSearchShortcut('openNow', handlers.openNow ?? null);
  return (
    <div>
      <input aria-label="saved field" />
      <div data-pane="open-now">
        <button>inside</button>
        <input aria-label="open now field" />
      </div>
    </div>
  );
}

function spies() {
  return { saved: vi.fn(), openNow: vi.fn() };
}

describe('useSearchShortcut routes by the pane holding focus', () => {
  test('focus on the page runs the saved handler only', async () => {
    const h = spies();
    render(<Harness handlers={h} />);
    await userEvent.setup().keyboard('/');
    expect(h.saved).toHaveBeenCalledTimes(1);
    expect(h.openNow).not.toHaveBeenCalled();
  });

  test('focus inside Open now runs its handler only', async () => {
    const h = spies();
    const view = render(<Harness handlers={h} />);
    view.getByRole('button', { name: 'inside' }).focus();
    await userEvent.setup().keyboard('/');
    expect(h.openNow).toHaveBeenCalledTimes(1);
    expect(h.saved).not.toHaveBeenCalled();
  });

  test('a pane with no handler is left alone: the key is not cancelled', () => {
    const h = spies();
    render(<Harness handlers={{ saved: h.saved }} />);
    const inside = document.querySelector('button');
    if (inside === null) throw new Error('no button');
    inside.focus();
    const event = new KeyboardEvent('keydown', {
      key: '/',
      bubbles: true,
      cancelable: true,
    });
    inside.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(h.saved).not.toHaveBeenCalled();
  });

  test('a handled key is cancelled', () => {
    const h = spies();
    render(<Harness handlers={h} />);
    const event = new KeyboardEvent('keydown', {
      key: '/',
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  test('a / typed in either field types a slash and runs nothing', async () => {
    const h = spies();
    const view = render(<Harness handlers={h} />);
    const user = userEvent.setup();
    for (const name of ['saved field', 'open now field']) {
      const input = view.getByRole('textbox', { name });
      await user.type(input, 'a/b');
      expect(input).toHaveValue('a/b');
      expect(document.activeElement).toBe(input);
    }
    expect(h.saved).not.toHaveBeenCalled();
    expect(h.openNow).not.toHaveBeenCalled();
  });

  test('the latest registration of a pane wins, and the one before returns when it unmounts', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const base = render(<Harness handlers={{ saved: first }} />);
    const top = render(<Harness handlers={{ saved: second }} />);
    const user = userEvent.setup();
    await user.keyboard('/');
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    top.unmount();
    await user.keyboard('/');
    expect(first).toHaveBeenCalledTimes(1);
    base.unmount();
  });

  test('a null handler on top defers to the one below', async () => {
    const below = vi.fn();
    render(<Harness handlers={{ saved: below }} />);
    render(<Harness handlers={{ saved: null }} />);
    await userEvent.setup().keyboard('/');
    expect(below).toHaveBeenCalledTimes(1);
  });

  test('one window listener serves every registration, and none remains after the last', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const keydowns = (spy: typeof add) =>
      spy.mock.calls.filter(([type]) => type === 'keydown').length;
    const a = render(<Harness handlers={spies()} />);
    const b = render(<Harness handlers={spies()} />);
    expect(keydowns(add)).toBe(1);
    a.unmount();
    expect(keydowns(remove)).toBe(0);
    b.unmount();
    expect(keydowns(remove)).toBe(1);
    add.mockRestore();
    remove.mockRestore();
  });

  test.each([
    ['a modifier', { key: '/', metaKey: true }],
    ['a repeat', { key: '/', repeat: true }],
  ])('%s leaves both handlers alone', (_n, init) => {
    const h = spies();
    render(<Harness handlers={h} />);
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    );
    expect(h.saved).not.toHaveBeenCalled();
    expect(h.openNow).not.toHaveBeenCalled();
  });

  test('an open <dialog> and a held row leave both handlers alone', () => {
    const h = spies();
    render(<Harness handlers={h} />);
    const dialog = document.body.appendChild(document.createElement('dialog'));
    dialog.setAttribute('open', '');
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: '/', bubbles: true })
    );
    dialog.remove();
    beginDragHold();
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: '/', bubbles: true })
    );
    expect(h.saved).not.toHaveBeenCalled();
    expect(h.openNow).not.toHaveBeenCalled();
  });
});
