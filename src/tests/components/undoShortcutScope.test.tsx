import { describe, expect, test } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import MainContainer from '../../components/MainContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-52. MainContainer registers a `window` keydown listener for ctrl/cmd
// +Z/+Y that only checks `isSettingsPage`. It never looks at `event.target`,
// so it also fires while a text input has focus: it dispatches the app's
// session-level undo AND calls preventDefault(), which suppresses the
// browser's native text undo. The user gets nothing back and no feedback.
//
// The probe is the ACTION RECORDER, not the store contents. `undo` no-ops
// when `past` is empty, and (see KAN-51) `restoreContainer` rebuilds
// tabGroups via .map() so undo changes object identity rather than values --
// a state-value check cannot see this trigger fire in either direction.
// Whether the action was dispatched at all is the thing under test.

const UNDO = 'undoRedo/undo';
const REDO = 'undoRedo/redo';

type Chord = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
};

// Dispatched on the element itself rather than typed into a focused field:
// keydown bubbles to the window listener carrying `target`, which is exactly
// the path the real event takes. Returning the event lets a caller assert on
// defaultPrevented -- the half of the defect that breaks native undo.
function press(target: EventTarget, chord: Chord) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...chord,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

const buildGroup = (title: string) => ({
  tabGroupId: 'group-1',
  title,
  createdTime: '2026-09-01 09:01:00',
  createdAt: Date.UTC(2026, 8, 1, 9, 1, 0),
  windowCount: 1,
  tabCount: 1,
  isAutoSave: false,
  isSelected: false,
  windows: [
    {
      windowId: 'win-1',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: 'Morning',
      tabs: [
        {
          tabId: 'w1-t0',
          favicon: '',
          title: 'Kagi',
          url: 'https://example.com/w1/t0',
        },
      ],
    },
  ],
});

describe('undo/redo shortcuts yield to native text editing (KAN-52)', () => {
  // CONTROL. Must stay green throughout: the guard has to scope the listener
  // down, not switch it off. Without this a "return early always" fix passes
  // every other test in this file.
  describe('outside a text field the app shortcut still works', () => {
    test('cmd+z on the document runs the app undo and claims the event', async () => {
      const { seen } = await renderWithProviders(<MainContainer />);

      const before = seen.length;
      const event = press(document.body, { key: 'z', metaKey: true });

      expect(seen.slice(before)).toContain(UNDO);
      expect(event.defaultPrevented).toBe(true);
    });

    test('cmd+shift+z on the document runs the app redo and claims the event', async () => {
      const { seen } = await renderWithProviders(<MainContainer />);

      const before = seen.length;
      const event = press(document.body, {
        key: 'z',
        metaKey: true,
        shiftKey: true,
      });

      expect(seen.slice(before)).toContain(REDO);
      expect(event.defaultPrevented).toBe(true);
    });
  });

  // RED. The "save all open windows as a session" box is on screen the moment
  // the popup opens, pre-filled with the current tab's title -- the single most
  // reachable text field in the app, needing no sign-in and no saved sessions.
  describe('inside the save-session name box', () => {
    test('cmd+z neither runs the app undo nor blocks the native one', async () => {
      const { container, seen } = await renderWithProviders(<MainContainer />);

      const input = container.querySelector('input#name');
      expect(input).toBeTruthy();

      const before = seen.length;
      const event = press(input!, { key: 'z', metaKey: true });

      expect(seen.slice(before)).not.toContain(UNDO);
      expect(event.defaultPrevented).toBe(false);
    });

    test('ctrl+z neither runs the app undo nor blocks the native one', async () => {
      const { container, seen } = await renderWithProviders(<MainContainer />);

      const input = container.querySelector('input#name');
      const before = seen.length;
      const event = press(input!, { key: 'z', ctrlKey: true });

      expect(seen.slice(before)).not.toContain(UNDO);
      expect(event.defaultPrevented).toBe(false);
    });

    // Redo is native inside a text field too -- cmd+shift+z on macOS, ctrl+y
    // on Windows. The ticket flagged this as worth checking rather than
    // assuming; the answer is that it has the same defect.
    test('cmd+shift+z neither runs the app redo nor blocks the native one', async () => {
      const { container, seen } = await renderWithProviders(<MainContainer />);

      const input = container.querySelector('input#name');
      const before = seen.length;
      const event = press(input!, { key: 'z', metaKey: true, shiftKey: true });

      expect(seen.slice(before)).not.toContain(REDO);
      expect(event.defaultPrevented).toBe(false);
    });

    test('ctrl+y neither runs the app redo nor blocks the native one', async () => {
      const { container, seen } = await renderWithProviders(<MainContainer />);

      const input = container.querySelector('input#name');
      const before = seen.length;
      const event = press(input!, { key: 'y', ctrlKey: true });

      expect(seen.slice(before)).not.toContain(REDO);
      expect(event.defaultPrevented).toBe(false);
    });
  });

  // The guard's contract is "any element the browser undoes natively", not
  // "the inputs this app happens to render today". Nothing in src/ is a
  // <textarea> or contentEditable, so without these two the clauses covering
  // them are dead weight that no test touches -- dropping them from the
  // predicate leaves the whole suite green. The elements are mounted directly
  // rather than found in the tree for that reason: the listener is on
  // `window`, so anything in the document reaches it by the real path.
  describe('other natively-undoable elements', () => {
    function mount(el: HTMLElement) {
      document.body.appendChild(el);
      return el;
    }

    test('cmd+z inside a textarea neither runs the app undo nor blocks the native one', async () => {
      const { seen } = await renderWithProviders(<MainContainer />);
      const area = mount(document.createElement('textarea'));

      const before = seen.length;
      const event = press(area, { key: 'z', metaKey: true });

      expect(seen.slice(before)).not.toContain(UNDO);
      expect(event.defaultPrevented).toBe(false);
      area.remove();
    });

    // jsdom does not implement isContentEditable -- it reads back `undefined`
    // even with the attribute set, and assigning `.contentEditable` throws.
    // Defining it is emulating the one browser API the guard depends on, not
    // stubbing the code under test: the predicate still runs for real and
    // still has to decide. Confirmed against a real contentEditable element
    // in the built extension separately, since jsdom cannot show that.
    test('cmd+z inside a contentEditable element neither runs the app undo nor blocks the native one', async () => {
      const { seen } = await renderWithProviders(<MainContainer />);
      const editable = mount(document.createElement('div'));
      Object.defineProperty(editable, 'isContentEditable', { value: true });

      const before = seen.length;
      const event = press(editable, { key: 'z', metaKey: true });

      expect(seen.slice(before)).not.toContain(UNDO);
      expect(event.defaultPrevented).toBe(false);
      editable.remove();
    });

    // The other half of the contract: a focusable NON-editable element must
    // still get the app shortcut. WindowEntryContainer renders exactly this --
    // a div with tabIndex={0} and its own onKeyDown -- so this is the shape
    // that would break if the guard keyed off "is focusable" instead.
    test('cmd+z on a focusable non-editable div still runs the app undo', async () => {
      const { seen } = await renderWithProviders(<MainContainer />);
      const div = mount(document.createElement('div'));
      div.tabIndex = 0;

      const before = seen.length;
      const event = press(div, { key: 'z', metaKey: true });

      expect(seen.slice(before)).toContain(UNDO);
      expect(event.defaultPrevented).toBe(true);
      div.remove();
    });
  });

  // RED. The ticket's headline scenario: mistyping a session rename and
  // reaching for cmd+z. Driven through the real UI (click the title to enter
  // edit mode) rather than by querying a hidden field, so the test also fails
  // if the rename affordance stops being reachable.
  describe('inside the session rename field', () => {
    test('cmd+z neither runs the app undo nor blocks the native one', async () => {
      const { seen } = await renderWithProviders(<MainContainer />, {
        seedStore: (s) => {
          s.dispatch(saveToTabContainerInternal(buildGroup('Research')));
          s.dispatch(selectTabContainer('group-1'));
        },
      });

      // By aria-label, not by title text: the session title also renders in
      // the left pane entry, so findByText('Research') matches two elements.
      await userEvent.click(await screen.findByLabelText('rename session'));
      const input = screen.getByDisplayValue('Research');

      const before = seen.length;
      const event = press(input, { key: 'z', metaKey: true });

      expect(seen.slice(before)).not.toContain(UNDO);
      expect(event.defaultPrevented).toBe(false);
    });
  });
});
