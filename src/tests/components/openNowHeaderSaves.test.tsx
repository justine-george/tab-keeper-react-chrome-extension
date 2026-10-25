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
import { setSearchInputText } from '../../redux/slices/globalStateSlice';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { RenderWithProvidersResult } from '../setup/renderWithProviders';
import { setupChromeFake } from '../setup/chrome.fake';
import type { ChromeSeed } from '../setup/chrome.fake';

// KAN-774 (his pick A). Open now's header offers all three saves, with the
// same items on a right-click of the header (KAN-708's pattern). KAN-780: Save
// current window is a button of its own, and the header's ⋮ is gone.

const SAVE_ALL = 'Save all open windows as a session';
const SAVE_CURRENT = 'Save current window as a session';
const PDF = 'Save open windows as PDF…';
// KAN-783. Copy all links sits after the two saves.
const ITEMS = [SAVE_ALL, SAVE_CURRENT, 'Copy all links', PDF];

function tabViewUrl(): string {
  const scratch = setupChromeFake();
  const url = chrome.runtime.getURL('index.html') + '?view=tab';
  scratch.restore();
  return url;
}

const TAB_VIEW_ID = 10;
const tab = (id: number, title: string, lastAccessed = 0) => ({
  id,
  title,
  url: `https://${title.toLowerCase()}.test/`,
  lastAccessed,
});
const tabView = () => ({
  id: TAB_VIEW_ID,
  url: tabViewUrl(),
  title: 'Tab Keeper',
  lastAccessed: 9000,
});

// Window 1 holds the full view ("This window"); window 2 is another.
const twoWindows: ChromeSeed = {
  currentTabId: TAB_VIEW_ID,
  windows: [
    {
      id: 1,
      focused: true,
      tabs: [tabView(), tab(11, 'A', 100), tab(12, 'B', 300)],
    },
    { id: 2, tabs: [tab(21, 'D', 200)] },
  ],
};

async function renderOpenNow(seed: ChromeSeed) {
  const result = await renderWithProviders(
    <>
      <OpenNowColumn folded={true} />
      <Toast />
    </>,
    { seed }
  );
  await screen.findAllByRole('button', { name: /^Switch to tab: / });
  return result;
}

type Store = RenderWithProvidersResult['store'];
const sessionsOf = (store: Store) =>
  store.getState().tabContainerDataState.tabGroups;
const header = () => {
  const el = document.querySelector('[data-open-now-header]');
  if (!(el instanceof HTMLElement)) throw new Error('no Open now header');
  return el;
};
const headerButton = (name: string) =>
  within(header()).getByRole('button', { name });
const openHeaderMenu = () =>
  fireEvent.contextMenu(
    within(header()).getByRole('heading', { name: 'Currently open' })
  );
const itemLabels = () =>
  within(screen.getByRole('menu'))
    .getAllByRole('menuitem')
    .map((item) => item.textContent?.replace(/^[a-z_]+/, ''));
const titlesOf = (window: { tabs: { title: string }[] }) =>
  window.tabs.map((saved) => saved.title);

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("Open now's header saves (KAN-774)", () => {
  test('Collapse, Save all, Save current window, Save as PDF, in that order, and no ⋮ (KAN-780)', async () => {
    await renderOpenNow(twoWindows);

    const labels = within(header())
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    const at = (name: string) => labels.indexOf(name);
    expect(at('Collapse all windows')).toBeGreaterThan(-1);
    expect(at(SAVE_ALL)).toBe(at('Collapse all windows') + 1);
    expect(at(SAVE_CURRENT)).toBe(at(SAVE_ALL) + 1);
    expect(at(PDF)).toBe(at(SAVE_CURRENT) + 1);
    expect(labels).not.toContain('More actions');
  });

  test("each save button wears its save's glyph and says its save in its tooltip", async () => {
    await renderOpenNow(twoWindows);

    const glyphOf = (name: string) =>
      headerButton(name)
        .querySelector('[data-icon]')
        ?.getAttribute('data-icon');
    expect(glyphOf(SAVE_ALL)).toBe('two_windows_add');
    expect(glyphOf(SAVE_CURRENT)).toBe('window_add');
    expect(headerButton(SAVE_CURRENT)).toHaveAttribute(
      'data-tooltip',
      SAVE_CURRENT
    );
  });

  test("Save current window saves This window alone, without Tab Keeper's tab", async () => {
    const { store } = await renderOpenNow(twoWindows);

    await userEvent.click(headerButton(SAVE_CURRENT));

    await waitFor(() => expect(sessionsOf(store)).toHaveLength(1));
    expect(sessionsOf(store)[0].windows.map(titlesOf)).toEqual([['A', 'B']]);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Current window saved as a session.'
    );
  });

  test('Save all from the right-click menu saves every listed window, as the icon does', async () => {
    const { store } = await renderOpenNow(twoWindows);

    openHeaderMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: SAVE_ALL }));

    await waitFor(() => expect(sessionsOf(store)).toHaveLength(1));
    expect(sessionsOf(store)[0].windows.map(titlesOf)).toEqual([
      ['A', 'B'],
      ['D'],
    ]);
    expect(screen.getByRole('status')).toHaveTextContent(
      'All open windows saved as a session.'
    );
  });

  // Worst path: Tab Keeper alone in its window, so This window is not listed.
  test('Save current window with Tab Keeper alone in its window: the toast, and nothing saved', async () => {
    const { store } = await renderOpenNow({
      currentTabId: TAB_VIEW_ID,
      windows: [
        { id: 1, focused: true, tabs: [tabView()] },
        { id: 2, tabs: [tab(21, 'D', 200)] },
      ],
    });

    await userEvent.click(headerButton(SAVE_CURRENT));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'No tabs to save in this window. Only Tab Keeper is open here.'
      )
    );
    expect(sessionsOf(store)).toEqual([]);
  });

  test("the right-click menu's Save current window saves This window alone too", async () => {
    const { store } = await renderOpenNow(twoWindows);

    openHeaderMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: SAVE_CURRENT }));

    await waitFor(() => expect(sessionsOf(store)).toHaveLength(1));
    expect(sessionsOf(store)[0].windows.map(titlesOf)).toEqual([['A', 'B']]);
  });

  test('the PDF icon opens the export of every open window', async () => {
    const { chrome } = await renderOpenNow(twoWindows);

    fireEvent.click(within(header()).getByRole('button', { name: PDF }));

    await waitFor(() => expect(chrome.createdTabs).toHaveLength(1));
    expect(chrome.createdTabs[0].url).toContain(
      'export.html?source=open-windows'
    );
  });

  test('right-clicking the header opens the same three items', async () => {
    await renderOpenNow(twoWindows);

    const event = fireEvent.contextMenu(
      within(header()).getByRole('heading', { name: 'Currently open' })
    );

    // Our menu, not Chrome's.
    expect(event).toBe(false);
    expect(itemLabels()).toEqual(ITEMS);
  });

  test('right-clicking the search field leaves Chrome its menu', async () => {
    await renderOpenNow(twoWindows);

    const event = fireEvent.contextMenu(
      screen.getByRole('textbox', { name: /Search open/i })
    );

    expect(event).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('while the saved search holds text: no save buttons, no PDF icon, and a right-click is left to Chrome', async () => {
    const { store } = await renderOpenNow(twoWindows);
    // CONTROL: all three are there before the search.
    for (const name of [SAVE_ALL, SAVE_CURRENT, PDF])
      expect(headerButton(name)).toBeInTheDocument();

    act(() => {
      store.dispatch(setSearchInputText('kagi'));
    });

    for (const name of [SAVE_ALL, SAVE_CURRENT, PDF])
      expect(within(header()).queryByRole('button', { name })).toBeNull();
    const event = fireEvent.contextMenu(
      within(header()).getByRole('heading', { name: 'Currently open' })
    );
    expect(event).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
