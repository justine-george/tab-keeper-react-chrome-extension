import { afterEach, describe, expect, test } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import OpenNowColumn from '../../components/home/opennow/OpenNowColumn';
import { Toast } from '../../components/common/Toast';
import { noteTabKeeperAction } from '../../redux/openNowMoveUndo';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';

// KAN-694. An Open now window's ⋮ is the last control in its action strip, and
// offers Sort tabs by site only where the live sort would run and change something.

afterEach(() => noteTabKeeperAction());

const url = (host: string, path = '') => `https://${host}.test/${path}`;
const tab = (
  id: number,
  host: string,
  extra: Partial<{ splitViewId: number; active: boolean }> = {}
) => ({ id, title: `${host}${id}`, url: url(host, String(id)), ...extra });

// W1 (This window) is unsorted; W2 is [a, b, a] unsorted too.
const seed = (
  w2: ReturnType<typeof tab>[],
  extra: Partial<ChromeSeed> = {}
): ChromeSeed => ({
  grantedPermissions: ['tabGroups'],
  windows: [
    {
      id: 1,
      focused: true,
      tabs: [tab(11, 'b', { active: true }), tab(12, 'a'), tab(13, 'b')],
    },
    { id: 2, tabs: w2 },
  ],
  ...extra,
});

const UNSORTED = () => [
  tab(21, 'a', { active: true }),
  tab(22, 'b'),
  tab(23, 'a'),
];

async function renderOpenNow(
  chromeSeed: ChromeSeed,
  { granted = true }: { granted?: boolean } = {}
) {
  const result = await renderWithProviders(
    <>
      <OpenNowColumn folded={true} />
      <Toast />
    </>,
    {
      seed: chromeSeed,
      seedStore: (store) => {
        if (granted) store.dispatch(setHasTabGroupsPermission(true));
      },
    }
  );
  await screen.findAllByRole('button', { name: /^Switch to tab: / });
  return result;
}

function blockOf(windowId: number): HTMLElement {
  const block = document.querySelector(`[data-open-window-id="${windowId}"]`);
  if (!(block instanceof HTMLElement)) throw new Error('no window block');
  return block;
}

function stripOf(windowId: number): HTMLElement {
  const strip =
    blockOf(windowId).querySelector<HTMLElement>('[data-row-actions]');
  if (!strip) throw new Error('no action strip');
  return strip;
}

// The strip's first control: its opacity is what shows or hides the strip.
const stripOpacity = (windowId: number) => {
  const first = stripOf(windowId).firstElementChild;
  if (!first) throw new Error('empty action strip');
  return getComputedStyle(first).opacity;
};

const moreActionsIn = (windowId: number) =>
  within(blockOf(windowId)).queryAllByRole('button', { name: 'More actions' });

const idsIn = async (windowId: number) =>
  (await chrome.tabs.query({ windowId }))
    .sort((x, y) => x.index - y.index)
    .map((t) => t.id);

describe('Open now window menu: Sort tabs by site (KAN-694)', () => {
  test('More actions is the last control of the strip, after Save and Close', async () => {
    await renderOpenNow(seed(UNSORTED()));
    const labels = within(stripOf(2))
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual([
      'Save window as a session: Window 2',
      'Close window: Window 2',
      'More actions',
    ]);
  });

  test('its one item is Sort tabs by site, and choosing it sorts the window and says so', async () => {
    const user = userEvent.setup();
    await renderOpenNow(seed(UNSORTED()));
    await user.click(moreActionsIn(2)[0]);
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    expect(
      items.map((i) => i.getAttribute('aria-label') ?? i.textContent)
    ).toEqual([expect.stringMatching(/Sort tabs by site$/)]);
    await user.click(items[0]);
    await waitFor(async () => expect(await idsIn(2)).toEqual([21, 23, 22]));
    expect(await screen.findByText('Sorted the tabs by site.')).toBeVisible();
  });

  test('is on This window too, where Close is absent', async () => {
    await renderOpenNow(seed(UNSORTED(), { currentTabId: 11 }));
    expect(moreActionsIn(1)).toHaveLength(1);
    expect(
      within(blockOf(1)).queryByRole('button', { name: /^Close window/ })
    ).toBeNull();
  });

  test('is absent when the window is already sorted', async () => {
    await renderOpenNow(
      seed([tab(21, 'a', { active: true }), tab(22, 'a'), tab(23, 'b')])
    );
    expect(moreActionsIn(2)).toHaveLength(0);
    expect(moreActionsIn(1)).toHaveLength(1);
  });

  test('is absent without the tab group grant', async () => {
    await renderOpenNow(seed(UNSORTED()), { granted: false });
    expect(moreActionsIn(2)).toHaveLength(0);
  });

  test('is absent when a tab of the window is in a split view', async () => {
    await renderOpenNow(
      seed(
        [
          tab(21, 'a', { active: true }),
          tab(22, 'b', { splitViewId: 70 }),
          tab(23, 'a', { splitViewId: 70 }),
        ],
        { splitView: true }
      )
    );
    expect(moreActionsIn(2)).toHaveLength(0);
  });

  test('is absent while an Open now search is held', async () => {
    const user = userEvent.setup();
    await renderOpenNow(seed(UNSORTED()));
    await user.type(
      screen.getByRole('textbox', { name: 'Search open tabs' }),
      'a'
    );
    expect(screen.queryAllByRole('button', { name: 'More actions' })).toEqual(
      []
    );
  });

  test('an open menu keeps the strip shown and lifts the window', async () => {
    const user = userEvent.setup();
    await renderOpenNow(seed(UNSORTED()));
    expect(stripOpacity(2)).toBe('0');
    await user.click(moreActionsIn(2)[0]);
    await user.unhover(moreActionsIn(2)[0]);
    const lifted = getComputedStyle(stripOf(2)).zIndex;
    expect(lifted).not.toBe('');
    expect(stripOpacity(2)).toBe('1');
    await act(async () => {
      await user.keyboard('{Escape}');
    });
    expect(getComputedStyle(stripOf(2)).zIndex).not.toBe(lifted);
    expect(stripOpacity(2)).toBe('0');
  });

  test('a menu that disappears while open leaves the strip hidden and not lifted', async () => {
    const user = userEvent.setup();
    await renderOpenNow(seed(UNSORTED()));
    const resting = getComputedStyle(stripOf(2)).zIndex;
    await user.click(moreActionsIn(2)[0]);
    await user.unhover(moreActionsIn(2)[0]);
    expect(stripOpacity(2)).toBe('1');
    // Sorted from outside: the window no longer offers the sort, so the menu unmounts.
    await act(async () => {
      await chrome.tabs.move(22, { index: 2 });
    });
    await waitFor(() => expect(moreActionsIn(2)).toHaveLength(0));
    expect(stripOpacity(2)).toBe('0');
    expect(getComputedStyle(stripOf(2)).zIndex).toBe(resting);
  });
});
