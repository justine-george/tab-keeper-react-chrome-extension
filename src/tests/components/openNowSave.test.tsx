import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import OpenNowColumn from '../../components/home/opennow/OpenNowColumn';
import { Toast } from '../../components/common/Toast';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { RenderWithProvidersResult } from '../setup/renderWithProviders';
import { setupChromeFake } from '../setup/chrome.fake';
import type { ChromeSeed } from '../setup/chrome.fake';

// KAN-280 O13. Save window and Save all in the Open now pane: what the pane
// shows becomes a saved session, named by rule 1 and announced by rule 2.
// OpenNowColumn is rendered, as openNowClose.test.tsx does, so the windows
// are the live read.

// The tab view's own address, which the pane and every save leave out.
function tabViewUrl(): string {
  const scratch = setupChromeFake();
  const url = chrome.runtime.getURL('index.html') + '?view=tab';
  scratch.restore();
  return url;
}

const TAB_VIEW_ID = 10;

const url = (name: string) => `https://${name.toLowerCase()}.test/`;
const tab = (id: number, title: string, lastAccessed = 0) => ({
  id,
  title,
  url: url(title),
  pinned: false,
  audible: false,
  lastAccessed,
});

// The tab view itself, the most recently used tab in its window: the tab the
// name must never come from.
const tabView = () => ({
  id: TAB_VIEW_ID,
  url: tabViewUrl(),
  title: 'Tab Keeper',
  lastAccessed: 9000,
});

async function renderOpenNow(
  seed: ChromeSeed,
  { groups = false }: { groups?: boolean } = {}
): Promise<RenderWithProvidersResult> {
  const result = await renderWithProviders(
    <>
      <OpenNowColumn folded={true} />
      <Toast />
    </>,
    {
      seed,
      seedStore: groups
        ? (store) => store.dispatch(setHasTabGroupsPermission(true))
        : undefined,
    }
  );
  await screen.findAllByRole('button', { name: /^Switch to tab: / });
  return result;
}

function blockOf(windowId: number): HTMLElement {
  const block = document.querySelector(`[data-open-window-id="${windowId}"]`);
  if (!(block instanceof HTMLElement)) {
    throw new Error(`no window block for window ${windowId}`);
  }
  return block;
}

type Store = RenderWithProvidersResult['store'];

const sessionsOf = (store: Store) =>
  store.getState().tabContainerDataState.tabGroups;

// Resolves once the save has landed. The click awaits a tabs.query for the
// name before it dispatches, so the store is a microtask or two behind.
async function savedSession(store: Store) {
  await waitFor(() => expect(sessionsOf(store)).toHaveLength(1));
  return sessionsOf(store)[0];
}

const tabTitlesOf = (window: { tabs: { title: string }[] }) =>
  window.tabs.map((saved) => saved.title);

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('saving from the Open now pane (KAN-280 O13)', () => {
  test('Save window saves that window alone, named for its front tab', async () => {
    const { store } = await renderOpenNow({
      currentTabId: TAB_VIEW_ID,
      windows: [
        { id: 1, focused: true, tabs: [tabView(), tab(11, 'A', 100)] },
        {
          id: 2,
          // Docs first, so "the first tab" and "the most recently used tab"
          // name different sessions.
          tabs: [
            tab(21, 'Docs', 200),
            { ...tab(22, '(3) Inbox', 500), active: true },
          ],
        },
      ],
    });

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save window as a session: Window 2',
      })
    );

    const saved = await savedSession(store);
    expect(saved.title).toBe('Inbox');
    expect(saved.windowCount).toBe(1);
    expect(saved.tabCount).toBe(2);
    expect(saved.windows.map(tabTitlesOf)).toEqual([['Docs', 'Inbox']]);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Window saved as a session.'
    );
  });

  test('This window has Save window too, and it leaves the Tab Keeper tab out', async () => {
    const { store } = await renderOpenNow({
      currentTabId: TAB_VIEW_ID,
      windows: [
        {
          id: 1,
          focused: true,
          tabs: [tabView(), tab(11, 'A', 100), tab(12, 'B', 300)],
        },
        { id: 2, tabs: [tab(21, 'D', 200)] },
      ],
    });

    // PREMISE: window 1 is the one tagged "This window".
    expect(within(blockOf(1)).getByText('This window')).toBeInTheDocument();
    fireEvent.click(
      within(blockOf(1)).getByRole('button', {
        name: 'Save window as a session: Window 1',
      })
    );

    const saved = await savedSession(store);
    // The tab view was used last, but it is Tab Keeper: B names it.
    expect(saved.title).toBe('B');
    expect(saved.windows.map(tabTitlesOf)).toEqual([['A', 'B']]);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Window saved as a session.'
    );
  });

  // The worst case for the name: Chrome closed the window after the pane drew
  // it and before the re-read, so the name's tabs.query finds nothing. The
  // row on screen is still what is saved, under the fallback name.
  test('Save window on a window Chrome has just closed saves what the row showed, as New Tab Group', async () => {
    const { store, chrome: fake } = await renderOpenNow({
      currentTabId: TAB_VIEW_ID,
      windows: [
        { id: 1, focused: true, tabs: [tabView(), tab(11, 'A', 100)] },
        { id: 2, tabs: [tab(21, 'D', 200), tab(22, 'E', 300)] },
      ],
    });
    const saveButton = screen.getByRole('button', {
      name: 'Save window as a session: Window 2',
    });

    fake.browser.closeWindow(2);
    fireEvent.click(saveButton);

    const saved = await savedSession(store);
    expect(saved.title).toBe('New Tab Group');
    expect(saved.windows.map(tabTitlesOf)).toEqual([['D', 'E']]);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Window saved as a session.'
    );
  });

  // Rule 1's name is read from Chrome, which can refuse. A save still
  // happens, under the fallback name.
  test('Save window saves as New Tab Group when Chrome refuses the tab read for its name', async () => {
    const { store } = await renderOpenNow({
      currentTabId: TAB_VIEW_ID,
      windows: [
        { id: 1, focused: true, tabs: [tabView(), tab(11, 'A', 100)] },
        { id: 2, tabs: [tab(21, 'D', 200), tab(22, 'E', 300)] },
      ],
    });
    const query = vi
      .spyOn(chrome.tabs, 'query')
      .mockRejectedValueOnce(new Error('No window with id: 2.'));

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save window as a session: Window 2',
      })
    );

    const saved = await savedSession(store);
    // PREMISE: the refused read was the name's.
    expect(query.mock.calls[0]).toEqual([{ windowId: 2 }]);
    expect(saved.title).toBe('New Tab Group');
    expect(saved.windows.map(tabTitlesOf)).toEqual([['D', 'E']]);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Window saved as a session.'
    );
  });

  // As the name box does (KAN-84): a name of only spaces is no name.
  test('Save window falls back to New Tab Group when the name source tab is titled only with spaces', async () => {
    const { store } = await renderOpenNow({
      currentTabId: TAB_VIEW_ID,
      windows: [
        { id: 1, focused: true, tabs: [tabView(), tab(11, 'A', 100)] },
        {
          id: 2,
          tabs: [tab(21, 'D', 200), { ...tab(22, 'Blank', 500), title: '   ' }],
        },
      ],
    });

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save window as a session: Window 2',
      })
    );

    const saved = await savedSession(store);
    expect(saved.title).toBe('New Tab Group');
  });

  test('every window row has Save window, first in its strip', async () => {
    await renderOpenNow({
      currentTabId: TAB_VIEW_ID,
      windows: [
        { id: 1, focused: true, tabs: [tabView(), tab(11, 'A')] },
        { id: 2, tabs: [tab(21, 'D')] },
      ],
    });

    const stripOf = (windowId: number) =>
      blockOf(windowId).querySelector('[data-row-actions]');
    const namesIn = (strip: Element | null) =>
      strip instanceof HTMLElement
        ? within(strip)
            .getAllByRole('button')
            .map((button) => button.getAttribute('aria-label'))
        : [];
    expect(namesIn(stripOf(1))).toEqual(['Save window as a session: Window 1']);
    expect(namesIn(stripOf(2))).toEqual([
      'Save window as a session: Window 2',
      'Close window: Window 2',
    ]);
  });

  test('Save all saves every listed window, This window first, named as the name box would', async () => {
    const { store } = await renderOpenNow({
      currentTabId: TAB_VIEW_ID,
      // "This window" is listed second, so the save has to move it.
      windows: [
        { id: 1, tabs: [tab(11, 'D', 800), tab(12, 'E', 700)] },
        {
          id: 2,
          focused: true,
          tabs: [tabView(), tab(21, 'A', 100), tab(22, '(2) B', 300)],
        },
        { id: 3, tabs: [tab(31, 'F', 600)] },
      ],
    });

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save all open windows as a session',
      })
    );

    const saved = await savedSession(store);
    expect(saved.windows.map(tabTitlesOf)).toEqual([
      ['A', 'B'],
      ['D', 'E'],
      ['F'],
    ]);
    // From This window alone, though D in window 1 was used more recently.
    expect(saved.title).toBe('B');
    expect(saved.windowCount).toBe(3);
    expect(saved.tabCount).toBe(5);
    expect(screen.getByRole('status')).toHaveTextContent(
      'All open windows saved as a session.'
    );
  });

  test('Save all names it New Tab Group when This window holds only Tab Keeper', async () => {
    const { store } = await renderOpenNow({
      currentTabId: TAB_VIEW_ID,
      windows: [
        { id: 1, focused: true, tabs: [tabView()] },
        { id: 2, tabs: [tab(21, 'D', 500)] },
      ],
    });

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save all open windows as a session',
      })
    );

    const saved = await savedSession(store);
    expect(saved.title).toBe('New Tab Group');
    expect(saved.windows.map(tabTitlesOf)).toEqual([['D']]);
  });

  test('Save all sits between Collapse all and the fold button', async () => {
    await renderOpenNow({
      currentTabId: TAB_VIEW_ID,
      windows: [{ id: 1, focused: true, tabs: [tabView(), tab(11, 'A')] }],
    });

    const pane = screen.getByRole('region', { name: 'Open now' });
    const headerNames = within(pane)
      .getAllByRole('button')
      .filter((button) => !button.closest('[data-open-window-id]'))
      .map((button) => button.getAttribute('aria-label'));
    expect(headerNames).toEqual([
      'Collapse all windows',
      'Save all open windows as a session',
      'Show the saved session',
    ]);
  });

  test('a saved group keeps its name and colour', async () => {
    const { store } = await renderOpenNow(
      {
        currentTabId: TAB_VIEW_ID,
        grantedPermissions: ['tabGroups'],
        windows: [
          { id: 1, focused: true, tabs: [tabView(), tab(11, 'A')] },
          {
            id: 2,
            tabs: [
              { ...tab(21, 'D', 200), groupId: 50 },
              { ...tab(22, 'E', 100), groupId: 50 },
              tab(23, 'F'),
            ],
          },
        ],
        tabGroups: [{ id: 50, title: 'Research', color: 'blue', windowId: 2 }],
      },
      { groups: true }
    );
    // PREMISE: the pane draws the group, so the snapshot holds it.
    expect(
      within(blockOf(2)).getByRole('group', { name: 'Research' })
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save window as a session: Window 2',
      })
    );

    const [saved] = (await savedSession(store)).windows;
    const [group] = saved.chromeTabGroups ?? [];
    expect(saved.chromeTabGroups).toHaveLength(1);
    expect(group).toMatchObject({ title: 'Research', color: 'blue' });
    expect(saved.tabs.map((savedTab) => savedTab.chromeGroupId)).toEqual([
      group.groupId,
      group.groupId,
      undefined,
    ]);
  });
});
