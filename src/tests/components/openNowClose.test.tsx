import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import OpenNowColumn from '../../components/home/opennow/OpenNowColumn';
import { Toast } from '../../components/common/Toast';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { renderWithProviders } from '../setup/renderWithProviders';
import { setupChromeFake } from '../setup/chrome.fake';
import type { ChromeSeed } from '../setup/chrome.fake';

// KAN-280 O7a. The Open now pane's close controls: × on each tab row, Close
// window on every window row but "This window", the Reopen offer after each
// close, and rule 8's focus moves. OpenNowColumn is rendered, not the pane,
// so the list is the live read (useOpenWindows) and every close comes back
// through Chrome's own events. Real timers: a re-read is 50ms away, and
// waitFor waits for it.

// jsdom runs inside Node, so `process` exists at runtime; tsconfig omits
// @types/node so app code cannot reach for it. The minimal shape the
// double-press test needs, as permissions.test.ts declares it.
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

// The strip's own emotion rules, as the stylesheet holds them.
function rulesFor(element: HTMLElement): string[] {
  const classes = [...element.classList].map((name) => `.${name}`);
  return [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .map((rule) => rule.cssText)
    .filter((text) => classes.some((name) => text.startsWith(name)));
}

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

const switchRow = (title: string) =>
  screen.getByRole('button', { name: `Switch to tab: ${title}` });
const querySwitchRow = (title: string) =>
  screen.queryByRole('button', { name: `Switch to tab: ${title}` });
const closeTabButton = (title: string) =>
  screen.getByRole('button', { name: `Close tab: ${title}` });

// A window's block by its Chrome id. Not by "Window N": the numbers are
// positions, and they move up when a window above goes.
function blockOf(windowId: number): HTMLElement {
  const block = document.querySelector(`[data-open-window-id="${windowId}"]`);
  if (!(block instanceof HTMLElement)) {
    throw new Error(`no window block for window ${windowId}`);
  }
  return block;
}

// A window row's collapse chevron: the first control in its block.
const chevronOf = (windowId: number): HTMLElement =>
  within(blockOf(windowId)).getAllByRole('button')[0];

// The tab titles one window draws, top to bottom.
const titlesIn = (windowId: number): string[] =>
  within(blockOf(windowId))
    .queryAllByRole('button', { name: /^Switch to tab: / })
    .map((row) =>
      (row.getAttribute('aria-label') ?? '').replace('Switch to tab: ', '')
    );

// Holds Chrome's answer to a close until the test releases it, while the
// close itself (and its events) happens at once. So the pane's re-read can
// land BEFORE the close resolves, as it can in a busy browser.
function holdTabRemoval(): () => void {
  const realRemove = chrome.tabs.remove.bind(chrome.tabs);
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(chrome.tabs, 'remove').mockImplementation(
    async (ids: number | number[]) => {
      await realRemove(Array.isArray(ids) ? ids : [ids]);
      await released;
    }
  );
  return release;
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
  vi.restoreAllMocks();
});

describe('closing from the Open now pane (KAN-280 O7a)', () => {
  test('each tab row has a Close tab control, named for its tab', async () => {
    await renderOpenNow(threeWindows());

    for (const title of ['A', 'B', 'C', 'D', 'E', 'F']) {
      expect(closeTabButton(title)).toBeInTheDocument();
    }
    // In the row it names, not merely somewhere on the page.
    expect(
      closeTabButton('B')
        .closest('[data-open-tab-id]')
        ?.getAttribute('data-open-tab-id')
    ).toBe('12');
  });

  test('closing a tab closes the real tab, drops its row, and offers Reopen', async () => {
    const { chrome: fake } = await renderOpenNow(threeWindows());

    fireEvent.click(closeTabButton('B'));

    await waitFor(() => expect(querySwitchRow('B')).toBeNull());
    expect(fake.removedTabIds).toEqual([12]);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Tab closed');
    expect(
      within(status).getByRole('button', { name: 'Reopen' })
    ).toBeInTheDocument();
  });

  test('Reopen from the pane brings the tab back into its row position', async () => {
    await renderOpenNow(threeWindows());
    fireEvent.click(closeTabButton('B'));
    await waitFor(() => expect(titlesIn(1)).toEqual(['A', 'C']));

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));

    // B's row shows its address: a reopened tab has no title until its page
    // loads, and the fake loads nothing.
    await waitFor(() => expect(titlesIn(1)).toEqual(['A', url('B'), 'C']));
  });

  test('"This window" has Save window only; other windows have Close window', async () => {
    await renderOpenNow(threeWindows());

    // PREMISE: window 1 is the one tagged "This window".
    expect(within(blockOf(1)).getByText('This window')).toBeInTheDocument();
    expect(
      within(blockOf(1)).queryByRole('button', { name: /^Close window/ })
    ).toBeNull();
    expect(
      within(blockOf(2)).getByRole('button', {
        name: 'Close window: Window 2',
      })
    ).toBeInTheDocument();
    expect(
      within(blockOf(3)).getByRole('button', {
        name: 'Close window: Window 3',
      })
    ).toBeInTheDocument();
  });

  test('closing a window closes it and says how many tabs it held', async () => {
    const { chrome: fake } = await renderOpenNow(threeWindows());

    fireEvent.click(
      screen.getByRole('button', { name: 'Close window: Window 2' })
    );

    await waitFor(() =>
      expect(document.querySelector('[data-open-window-id="2"]')).toBeNull()
    );
    expect(fake.removedWindowIds).toEqual([2]);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Window closed (2 tabs)'
    );
    expect(
      within(screen.getByRole('status')).getByRole('button', {
        name: 'Reopen',
      })
    ).toBeInTheDocument();
  });

  // Rule 8. Chrome's answer is held until after the re-read has dropped the
  // row, so focus that waited for the close would find its row already gone.
  test('after closing a tab, focus is on the next tab in its window', async () => {
    await renderOpenNow(threeWindows());
    const release = holdTabRemoval();

    fireEvent.click(closeTabButton('B'));
    await waitFor(() => expect(querySwitchRow('B')).toBeNull());
    await act(async () => release());

    expect(document.activeElement).toBe(switchRow('C'));
  });

  test('after closing the last tab in a window list, focus is on the previous tab', async () => {
    await renderOpenNow(threeWindows());

    fireEvent.click(closeTabButton('C'));
    await waitFor(() => expect(querySwitchRow('C')).toBeNull());

    expect(document.activeElement).toBe(switchRow('B'));
  });

  // A window with no tab left to list is no longer listed, even when Chrome
  // keeps it open for a Tab Keeper page (KAN-300's rule): its row goes with
  // its last tab. So focus goes where closing the window would send it.
  test("after closing a window's only listed tab, focus is on the next window's chevron", async () => {
    const { chrome: fake } = await renderOpenNow({
      currentTabId: TAB_VIEW_ID,
      windows: [
        {
          id: 1,
          tabs: [
            { id: TAB_VIEW_ID, url: tabViewUrl(), title: 'Tab Keeper' },
            tab(11, 'A'),
          ],
        },
        { id: 2, tabs: [tab(21, 'D'), tab(22, 'E')] },
      ],
    });

    fireEvent.click(closeTabButton('A'));
    await waitFor(() =>
      expect(document.querySelector('[data-open-window-id="1"]')).toBeNull()
    );

    // PREMISE: Chrome kept window 1 open; only the pane dropped it.
    expect(fake.removedWindowIds).toEqual([]);
    expect((await chrome.tabs.query({ windowId: 1 })).map((t) => t.id)).toEqual(
      [TAB_VIEW_ID]
    );
    expect(document.activeElement).toBe(chevronOf(2));
    expect(document.activeElement).toHaveAttribute('aria-expanded', 'true');
  });

  test("after closing a window's last tab, the window goes, and focus is on the previous window's chevron", async () => {
    await renderOpenNow(threeWindows());

    fireEvent.click(closeTabButton('F'));
    await waitFor(() =>
      expect(document.querySelector('[data-open-window-id="3"]')).toBeNull()
    );

    expect(document.activeElement).toBe(chevronOf(2));
  });

  test('after closing a window, focus is on the next window, else the previous, else the heading', async () => {
    // Window 1 holds only the tab view, so it is not listed: every listed
    // window can be closed.
    await renderOpenNow({
      currentTabId: TAB_VIEW_ID,
      windows: [
        { id: 1, tabs: [{ id: TAB_VIEW_ID, url: tabViewUrl() }] },
        { id: 2, tabs: [tab(21, 'D')] },
        { id: 3, tabs: [tab(31, 'E')] },
        { id: 4, tabs: [tab(41, 'F')] },
      ],
    });
    const gone = (windowId: number) =>
      waitFor(() =>
        expect(
          document.querySelector(`[data-open-window-id="${windowId}"]`)
        ).toBeNull()
      );

    // Next. Chrome's answer is held until the re-read has dropped the row.
    const release = holdWindowRemoval();
    fireEvent.click(
      screen.getByRole('button', { name: 'Close window: Window 1' })
    );
    await gone(2);
    await act(async () => release());
    expect(document.activeElement).toBe(chevronOf(3));

    // Previous: window 4 is last.
    fireEvent.click(
      screen.getByRole('button', { name: 'Close window: Window 2' })
    );
    await gone(4);
    expect(document.activeElement).toBe(chevronOf(3));

    // Neither: the heading.
    fireEvent.click(
      screen.getByRole('button', { name: 'Close window: Window 1' })
    );
    await gone(3);
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Open now' })
    );
  });

  // Review Focus 3: a double click, or Enter held. The second tabs.remove
  // rejects because the tab is already gone.
  test('pressing Close tab twice gives one toast and no unhandled rejection', async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);
    try {
      const { chrome: fake, seen } = await renderOpenNow(threeWindows());
      const removeSpy = vi.spyOn(chrome.tabs, 'remove');
      const button = closeTabButton('B');

      // Both presses land before React re-renders or the re-read runs.
      act(() => {
        button.click();
        button.click();
      });
      await waitFor(() => expect(querySwitchRow('B')).toBeNull());
      // Long enough for an unhandled rejection to be reported.
      await new Promise((resolve) => setTimeout(resolve, 20));

      // PREMISE: both presses reached Chrome; the second found nothing.
      expect(removeSpy).toHaveBeenCalledTimes(2);
      expect(fake.removedTabIds).toEqual([12]);
      expect(
        seen.filter((type) => type === 'global/offerReopen/pending')
      ).toHaveLength(1);
      expect(rejections).toEqual([]);

      // The first offer is intact.
      fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
      await waitFor(() => expect(titlesIn(1)).toEqual(['A', url('B'), 'C']));
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  test('a live refresh does not move focus', async () => {
    const { chrome: fake } = await renderOpenNow(threeWindows());
    act(() => switchRow('B').focus());
    const focused = document.activeElement;

    // A row above it goes, one below it changes, and a window gains a tab.
    act(() => {
      fake.browser.closeTab(11);
      fake.browser.updateTab(13, { title: 'C2' });
      fake.browser.openTab(2, { title: 'G', url: url('g') });
    });
    await screen.findByRole('button', { name: 'Switch to tab: C2' });
    await screen.findByRole('button', { name: 'Switch to tab: G' });

    expect(document.activeElement).toBe(focused);
    expect(focused?.isConnected).toBe(true);
    expect(document.activeElement).toBe(switchRow('B'));
  });

  // jsdom cannot cascade the reveal itself: its selector engine does not
  // match `.strip:focus-within > *`, so a computed opacity reads 0 either
  // way. So: focus is in the strip, and the strip's own rule reveals.
  function expectRevealedByFocus(control: HTMLElement): void {
    expect(document.activeElement).toBe(control);
    const strip = control.closest('[data-row-actions]');
    if (!(strip instanceof HTMLElement)) throw new Error('no action strip');
    expect(strip.matches(':focus-within')).toBe(true);
    const rules = rulesFor(strip);
    expect(rules).toContainEqual(
      expect.stringMatching(/:focus-within>\* \{ opacity: 1; \}/)
    );
    expect(rules).toContainEqual(
      expect.stringMatching(
        new RegExp(`:focus-within \\{ background-color: ${HOVER_RGB}; \\}`)
      )
    );
  }

  test('the close control is revealed by keyboard focus', async () => {
    await renderOpenNow(threeWindows());
    const user = userEvent.setup();
    act(() => switchRow('B').focus());

    await user.tab();

    expectRevealedByFocus(closeTabButton('B'));
  });

  // Save window (O13) comes first in the strip, so Close window is the
  // second Tab stop after the chevron.
  test('Close window is revealed by keyboard focus', async () => {
    await renderOpenNow(threeWindows());
    const user = userEvent.setup();
    act(() => chevronOf(2).focus());

    await user.tab();
    await user.tab();

    expectRevealedByFocus(
      screen.getByRole('button', { name: 'Close window: Window 2' })
    );
  });

  // KAN-127: hover follows the tab, not its position, so a re-read that
  // moves rows does not hand the reveal to whichever tab moved into place.
  test('hovering a tab row reveals its own close control, and it stays with that tab when rows move', async () => {
    const { chrome: fake } = await renderOpenNow(threeWindows());
    const rowOf = (title: string): HTMLElement => {
      const row = closeTabButton(title).closest('[data-open-tab-id]');
      if (!(row instanceof HTMLElement)) throw new Error(`no row ${title}`);
      return row;
    };
    const opacityOf = (title: string) =>
      getComputedStyle(closeTabButton(title)).opacity;
    // CONTROL: hidden at rest.
    expect(opacityOf('B')).toBe('0');

    fireEvent.mouseEnter(rowOf('B'));

    expect(opacityOf('B')).toBe('1');
    expect(opacityOf('C')).toBe('0');

    // A goes, so B and C each move up a place.
    act(() => fake.browser.closeTab(11));
    await waitFor(() => expect(querySwitchRow('A')).toBeNull());

    expect(opacityOf('B')).toBe('1');
    expect(opacityOf('C')).toBe('0');
    // KAN-100: the mask lands in one frame; only the icons ease.
    const strip = closeTabButton('B').parentElement;
    if (!(strip instanceof HTMLElement)) throw new Error('no action strip');
    expect(getComputedStyle(strip).backgroundColor).toMatch(
      new RegExp(HOVER_RGB)
    );
    expect(rulesFor(strip).join('\n')).not.toMatch(/transition[^;]*background/);
  });

  test('hovering a window row reveals Close window', async () => {
    await renderOpenNow(threeWindows());
    const close = screen.getByRole('button', {
      name: 'Close window: Window 2',
    });
    const row = close.closest('[data-row-actions]')?.parentElement;
    if (!(row instanceof HTMLElement)) throw new Error('no window row');
    // CONTROL: hidden at rest.
    expect(getComputedStyle(close).opacity).toBe('0');

    fireEvent.mouseEnter(row);

    expect(getComputedStyle(close).opacity).toBe('1');

    fireEvent.mouseLeave(row);

    expect(getComputedStyle(close).opacity).toBe('0');
  });
});
