import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import OpenNowColumn from '../../components/home/opennow/OpenNowColumn';
import { Toast } from '../../components/common/Toast';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { renderWithProviders } from '../setup/renderWithProviders';
import { setupChromeFake } from '../setup/chrome.fake';
import type { ChromeSeed } from '../setup/chrome.fake';
import { hoverRulesFor } from '../setup/hoverRules';
import { clearReopenFocus } from '../../redux/reopenFocus';

// KAN-331 O15. A window row in the Open now pane goes to its window. Same
// harness as openNowClose.test.tsx: OpenNowColumn is rendered, folded, so the
// list is the live read and every change comes back through Chrome's events.
// Real timers: a re-read is 50ms away, and waitFor waits for it.

// jsdom runs inside Node, so `process` exists at runtime; tsconfig omits
// @types/node so app code cannot reach for it. The minimal shape the
// gone-window test needs, as permissions.test.ts declares it.
declare const process: {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
};

// The tab view's own address, which the pane leaves out. The fake's getURL
// spells it, so a throwaway fake is installed just to read it (the same
// trick as useOpenWindows.test.tsx).
function tabViewUrl(): string {
  const scratch = setupChromeFake();
  const url = chrome.runtime.getURL('index.html') + '?view=tab';
  scratch.restore();
  return url;
}

const TAB_VIEW_ID = 10;

// LIGHT_THEME.HOVER_COLOR as the stylesheet spells it.
const HOVER_RGB = (() => {
  const [r, g, b] = [1, 3, 5].map((i) =>
    parseInt(LIGHT_THEME.HOVER_COLOR.slice(i, i + 2), 16)
  );
  return `rgb\\(${r}, ${g}, ${b}\\)`;
})();

const url = (name: string) => `https://${name.toLowerCase()}.test/`;
const tab = (id: number, title: string) => ({
  id,
  title,
  url: url(title),
  pinned: false,
  audible: false,
});

// Window 1 is "This window": it holds the tab view (left out of the list)
// and A, B, C. Window 2 holds D and E, window 3 holds F alone.
function threeWindows(): ChromeSeed {
  return {
    currentTabId: TAB_VIEW_ID,
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: TAB_VIEW_ID, url: tabViewUrl(), title: 'Tab Keeper' },
          tab(11, 'A'),
          tab(12, 'B'),
          tab(13, 'C'),
        ],
      },
      { id: 2, tabs: [tab(21, 'D'), tab(22, 'E')] },
      { id: 3, tabs: [tab(31, 'F')] },
    ],
  };
}

async function renderOpenNow(seed: ChromeSeed) {
  const result = await renderWithProviders(
    <>
      {/* Folded: the pane at any width, never the rail. */}
      <OpenNowColumn folded={true} />
      <Toast />
    </>,
    { seed }
  );
  // The first read has landed once any tab row is drawn.
  await screen.findAllByRole('button', { name: /^Switch to tab: / });
  return result;
}

// A window's block by its Chrome id. Not by "Window N": the numbers are
// positions, and they move up when a window above goes.
function blockOf(windowId: number): HTMLElement {
  const block = document.querySelector(`[data-open-window-id="${windowId}"]`);
  if (!(block instanceof HTMLElement)) {
    throw new Error(`no window block for window ${windowId}`);
  }
  return block;
}

function holdWindowRemoval(): () => void {
  const realRemove = chrome.windows.remove.bind(chrome.windows);
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(chrome.windows, 'remove').mockImplementation(
    async (windowId: number) => {
      await realRemove(windowId);
      await released;
    }
  );
  return release;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  clearReopenFocus();
  vi.restoreAllMocks();
});

const goTo = (n: number) =>
  screen.queryByRole('button', { name: `Go to window: Window ${n}` });
const focusedWindow = async () => (await chrome.windows.getLastFocused()).id;
const rowOf = (windowId: number): HTMLElement => {
  const row = blockOf(windowId).querySelector('[data-window-row]');
  if (!(row instanceof HTMLElement)) throw new Error(`no row for ${windowId}`);
  return row;
};
const chevronOf = (windowId: number): HTMLElement =>
  within(blockOf(windowId)).getAllByRole('button')[0];

describe('a window row goes to its window (KAN-331 O15)', () => {
  test('a click focuses that Chrome window; its front tab stays its front tab', async () => {
    const seed = threeWindows();
    // The seed gives no tab a front place; E is window 2's.
    await renderOpenNow({
      ...seed,
      windows: (seed.windows ?? []).map((win) =>
        win.id === 2
          ? {
              ...win,
              tabs: (win.tabs ?? []).map((t) => ({
                ...t,
                active: t.id === 22,
              })),
            }
          : win
      ),
    });
    const frontTab = async () =>
      (await chrome.tabs.query({ windowId: 2, active: true }))[0]?.id;
    expect(await frontTab()).toBe(22);
    const button = goTo(2);
    expect(button).not.toBeNull();
    await userEvent.click(button ?? document.body);
    await waitFor(async () => expect(await focusedWindow()).toBe(2));
    expect(await frontTab()).toBe(22);
  });

  test.each(['{Enter}', ' '])(
    '%s on the focused row does the same',
    async (key) => {
      await renderOpenNow(threeWindows());
      goTo(3)?.focus();
      await userEvent.keyboard(key);
      await waitFor(async () => expect(await focusedWindow()).toBe(3));
    }
  );

  test('H2: the tooltip is the phrase alone', async () => {
    await renderOpenNow(threeWindows());
    expect(goTo(2)).toHaveAttribute('title', 'Go to window');
  });

  test('W2 A: "This window" has no button, and its title is still drawn', async () => {
    await renderOpenNow(threeWindows());
    expect(goTo(1)).toBeNull();
    expect(within(rowOf(1)).getByText('Window 1')).toBeInTheDocument();
  });

  test('the chevron and Save window never focus the window', async () => {
    await renderOpenNow(threeWindows());
    const update = vi.spyOn(chrome.windows, 'update');
    await userEvent.click(
      screen.getByRole('button', { name: 'Collapse: Window 2' })
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Save window as a session: Window 2' })
    );
    // focusOpenWindow reads the window before it updates it, so a late focus
    // lands after the click returns; give it the time the gone-window test does.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      update.mock.calls.filter(([, info]) => info.focused === true)
    ).toEqual([]);
  });

  test('Close window never focuses a window', async () => {
    await renderOpenNow(threeWindows());
    const update = vi.spyOn(chrome.windows, 'update');
    await userEvent.click(
      screen.getByRole('button', { name: 'Close window: Window 2' })
    );
    await waitFor(() =>
      expect(document.querySelector('[data-open-window-id="2"]')).toBeNull()
    );
    // Same settle as above: a late focus lands after the click returns.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      update.mock.calls.filter(([, info]) => info.focused === true)
    ).toEqual([]);
  });

  test('S2: while a search is held no row is a button; clearing brings them back', async () => {
    await renderOpenNow(threeWindows());
    const field = screen.getByRole('textbox', { name: 'Search open tabs' });
    await userEvent.type(field, 'd'); // D is in window 2
    await waitFor(() => expect(goTo(2)).toBeNull());
    expect(within(rowOf(2)).getByText('Window 2')).toBeInTheDocument();
    await userEvent.clear(field);
    await waitFor(() => expect(goTo(2)).not.toBeNull());
  });

  test('T2 and S2: only a button row shades on hover', async () => {
    await renderOpenNow(threeWindows());
    // hoverRulesFor: jsdom cannot hover, so the injected :hover rule is what a
    // component test can hold (real hover: the e2e spec).
    expect(hoverRulesFor(rowOf(2))).toMatch(new RegExp(HOVER_RGB));
    expect(hoverRulesFor(rowOf(1))).not.toMatch(new RegExp(HOVER_RGB));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Search open tabs' }),
      'd'
    );
    await waitFor(() => expect(goTo(2)).toBeNull());
    expect(hoverRulesFor(rowOf(2))).not.toMatch(new RegExp(HOVER_RGB));
  });

  test('a window gone before the click: nothing happens, nothing is thrown', async () => {
    await renderOpenNow(threeWindows());
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    vi.spyOn(chrome.windows, 'get').mockRejectedValue(
      new Error('No window with id: 2.')
    );
    await userEvent.click(goTo(2) ?? document.body);
    await new Promise((resolve) => setTimeout(resolve, 50));
    process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toEqual([]);
    expect(await focusedWindow()).toBe(1);
  });

  test('the row that holds Tab Keeper follows its tab live', async () => {
    const { chrome: fake } = await renderOpenNow(threeWindows());
    fake.browser.moveTabToWindow(TAB_VIEW_ID, 2);
    await waitFor(() => expect(goTo(2)).toBeNull());
    // Window numbering is getAll order, so window 1 is still "Window 1".
    expect(goTo(1)).not.toBeNull();
  });

  test('an incognito window goes like any other', async () => {
    const seed = threeWindows();
    await renderOpenNow({
      ...seed,
      windows: (seed.windows ?? []).map((win) =>
        win.id === 3 ? { ...win, incognito: true } : win
      ),
    });
    await userEvent.click(goTo(3) ?? document.body);
    await waitFor(async () => expect(await focusedWindow()).toBe(3));
  });

  // Window names are positions: once window 2 goes, window 3 is "Window 2".
  // The name check is what tells the chevron from a button placed before it.
  test('O7b: after Close window, focus lands on the next chevron, not its new button', async () => {
    await renderOpenNow(threeWindows());
    const release = holdWindowRemoval();
    await userEvent.click(
      screen.getByRole('button', { name: 'Close window: Window 2' })
    );
    await waitFor(() =>
      expect(document.querySelector('[data-open-window-id="2"]')).toBeNull()
    );
    await act(async () => release());
    expect(document.activeElement).toBe(chevronOf(3));
    expect(blockOf(3)).toContainElement(
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    );
    expect(document.activeElement).toHaveAccessibleName('Collapse: Window 2');
  });

  test('K1: ↓/↑ skip window rows; a key on a window row moves nothing', async () => {
    await renderOpenNow(threeWindows());
    screen.getByRole('button', { name: 'Switch to tab: C' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toHaveAccessibleName('Switch to tab: D');
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toHaveAccessibleName('Switch to tab: C');
    goTo(2)?.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toHaveAccessibleName(
      'Go to window: Window 2'
    );
  });
});
