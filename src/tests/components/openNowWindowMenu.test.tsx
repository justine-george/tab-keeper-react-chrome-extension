import { describe, expect, test } from 'vitest';
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
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { hoverRulesFor } from '../setup/hoverRules';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import { asWritten } from '../setup/asWritten';

// KAN-694, KAN-696. An Open now window's strip is a labeled Save, then a ⋮. The
// ⋮ starts with Copy all links (KAN-783), offers Sort tabs by site only where
// the live sort would run and change something, and ends with Close window,
// which This window does not have.

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
  within(blockOf(windowId)).queryAllByRole('button', {
    name: `More actions: Window ${windowId}`,
  });

const idsIn = async (windowId: number) =>
  (await chrome.tabs.query({ windowId }))
    .sort((x, y) => x.index - y.index)
    .map((t) => t.id);

// The menu's items, by their stable key, in order.
const menuKeys = () =>
  within(screen.getByRole('menu'))
    .getAllByRole('menuitem')
    .map((i) => i.getAttribute('data-menu-item'));

async function openMenu(
  user: ReturnType<typeof userEvent.setup>,
  windowId: number
) {
  await user.click(moreActionsIn(windowId)[0]);
}

describe('Open now window header: Save and a ⋮ (KAN-696)', () => {
  test('the strip is Save, then More actions, and has no inline Close window', async () => {
    await renderOpenNow(seed(UNSORTED()));
    const labels = within(stripOf(2))
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual([
      'Save window as a session: Window 2',
      'More actions: Window 2',
    ]);
    expect(
      within(blockOf(2)).queryByRole('button', { name: /^Close window/ })
    ).toBeNull();
  });

  test('Save shows its word, and saving says so', async () => {
    const user = userEvent.setup();
    await renderOpenNow(seed(UNSORTED()));
    const save = within(stripOf(2)).getByRole('button', {
      name: 'Save window as a session: Window 2',
    });
    expect(save).toHaveTextContent('Save');
    await user.click(save);
    expect(await screen.findByText('Window saved as a session.')).toBeVisible();
  });

  test('the menu lists Copy all links, Sort tabs by site, then Close window last in the danger style', async () => {
    const user = userEvent.setup();
    await renderOpenNow(seed(UNSORTED()));
    await openMenu(user, 2);
    expect(menuKeys()).toEqual(['copy', 'sortBySite', 'closeWindow']);
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    expect(items[items.length - 1]).toHaveTextContent('Close window');
    // KAN-725. Danger is the red hover fill, derived from the token (jsdom writes rgb()).
    const DELETE_FILL = new RegExp(
      `background-color:\\s*${asWritten(LIGHT_THEME.DANGER_FILL).source}`,
      'i'
    );
    expect(hoverRulesFor(items[2])).toMatch(DELETE_FILL);
    expect(hoverRulesFor(items[0])).not.toMatch(DELETE_FILL);
    expect(hoverRulesFor(items[1])).not.toMatch(DELETE_FILL);
  });

  test('choosing Close window closes the window and offers Reopen', async () => {
    const user = userEvent.setup();
    await renderOpenNow(seed(UNSORTED()));
    await openMenu(user, 2);
    await user.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Close window',
      })
    );
    expect(await screen.findByText('Window closed (3 tabs).')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeVisible();
    await waitFor(async () =>
      expect((await chrome.windows.getAll()).map((w) => w.id)).toEqual([1])
    );
  });

  test('no Sort when the window is already sorted', async () => {
    const user = userEvent.setup();
    await renderOpenNow(
      seed([tab(21, 'a', { active: true }), tab(22, 'a'), tab(23, 'b')])
    );
    await openMenu(user, 2);
    expect(menuKeys()).toEqual(['copy', 'closeWindow']);
  });

  test('no Sort without the tab group grant', async () => {
    const user = userEvent.setup();
    await renderOpenNow(seed(UNSORTED()), { granted: false });
    await openMenu(user, 2);
    expect(menuKeys()).toEqual(['copy', 'closeWindow']);
  });

  test('no Sort when a tab of the window is in a split view', async () => {
    const user = userEvent.setup();
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
    await openMenu(user, 2);
    expect(menuKeys()).toEqual(['copy', 'closeWindow']);
  });

  test('after Save and Close the Sort item is still the one before Close window', async () => {
    const user = userEvent.setup();
    await renderOpenNow(seed(UNSORTED()));
    await user.click(
      within(stripOf(2)).getByRole('button', {
        name: 'Save window as a session: Window 2',
      })
    );
    await screen.findByText('Window saved as a session.');
    await openMenu(user, 2);
    expect(menuKeys()).toEqual(['copy', 'sortBySite', 'closeWindow']);
  });

  test('choosing Sort sorts the window and says so, and the ⋮ stays', async () => {
    const user = userEvent.setup();
    await renderOpenNow(seed(UNSORTED()));
    await openMenu(user, 2);
    await user.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Sort tabs by site',
      })
    );
    await waitFor(async () => expect(await idsIn(2)).toEqual([21, 23, 22]));
    expect(await screen.findByText('Sorted the tabs by site.')).toBeVisible();
    // Sorted, it still has Close window, so the ⋮ does not unmount (KAN-694's
    // menu did, and left the strip lifted).
    expect(moreActionsIn(2)).toHaveLength(1);
  });

  test('This window: the ⋮ holds Copy all links and Sort, with no Close window', async () => {
    const user = userEvent.setup();
    await renderOpenNow(seed(UNSORTED(), { currentTabId: 11 }));
    expect(moreActionsIn(1)).toHaveLength(1);
    await openMenu(user, 1);
    expect(menuKeys()).toEqual(['copy', 'sortBySite']);
  });

  // KAN-783. Before Copy all links, This window had no ⋮ here.
  test('This window: with Sort not offered the ⋮ still holds Copy all links', async () => {
    const user = userEvent.setup();
    await renderOpenNow(seed(UNSORTED(), { currentTabId: 11 }), {
      granted: false,
    });
    expect(
      within(stripOf(1))
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label'))
    ).toEqual(['Save window as a session: Window 1', 'More actions: Window 1']);
    await openMenu(user, 1);
    expect(menuKeys()).toEqual(['copy']);
  });

  test('a held Open now search renders no strip', async () => {
    const user = userEvent.setup();
    await renderOpenNow(seed(UNSORTED()));
    await user.type(
      screen.getByRole('textbox', { name: 'Search open tabs' }),
      'a'
    );
    expect(
      screen.queryAllByRole('button', { name: /^More actions: Window / })
    ).toEqual([]);
    expect(
      screen.queryAllByRole('button', {
        name: /^Save window as a session: /,
      })
    ).toEqual([]);
  });

  test('an open menu keeps the strip shown and lifts the window', async () => {
    const user = userEvent.setup();
    await renderOpenNow(seed(UNSORTED()));
    expect(stripOpacity(2)).toBe('0');
    await openMenu(user, 2);
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

  test('a menu whose Sort item goes away while open stays mounted and lifted', async () => {
    const user = userEvent.setup();
    await renderOpenNow(seed(UNSORTED()));
    await openMenu(user, 2);
    await user.unhover(moreActionsIn(2)[0]);
    // Sorted from outside: the Sort item goes, Close window stays.
    await act(async () => {
      await chrome.tabs.move(22, { index: 2 });
    });
    await waitFor(() => expect(menuKeys()).toEqual(['copy', 'closeWindow']));
    expect(moreActionsIn(2)).toHaveLength(1);
    expect(stripOpacity(2)).toBe('1');
    // Focus went with the Sort item, so Escape has no menu to hear it: an outside press closes.
    await user.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(stripOpacity(2)).toBe('0');
  });

  // KAN-783. This window's ⋮ used to unmount here, its only item gone; Copy all links keeps it.
  test("This window's menu stays open when its Sort item goes", async () => {
    const user = userEvent.setup();
    await renderOpenNow(seed(UNSORTED(), { currentTabId: 11 }));
    await openMenu(user, 1);
    await user.unhover(moreActionsIn(1)[0]);
    await act(async () => {
      await chrome.tabs.move(12, { index: 2 });
    });
    await waitFor(() => expect(menuKeys()).toEqual(['copy']));
    expect(moreActionsIn(1)).toHaveLength(1);
    expect(stripOpacity(1)).toBe('1');
  });
});

// KAN-708. The window row's right-click offers what its ⋮ offers.
describe('an Open now window row right-click (KAN-708)', () => {
  const windowRow = (windowId: number) => {
    const row = blockOf(windowId).querySelector('[data-window-row]');
    if (!(row instanceof HTMLElement)) throw new Error('no window row');
    return row;
  };
  const rowMenus = () => [
    ...document.querySelectorAll<HTMLElement>('[data-row-menu]'),
  ];

  test('right-click = its ⋮ items: Copy all links, Sort tabs by site when offered, Close window last', async () => {
    await renderOpenNow(seed(UNSORTED()));

    expect(fireEvent.contextMenu(windowRow(2))).toBe(false);

    expect(rowMenus()).toHaveLength(1);
    expect(menuKeys()).toEqual(['copy', 'sortBySite', 'closeWindow']);
  });

  test('Sort tabs by site is left out where the ⋮ leaves it out', async () => {
    await renderOpenNow(
      seed([tab(21, 'a', { active: true }), tab(22, 'a'), tab(23, 'b')])
    );

    fireEvent.contextMenu(windowRow(2));

    expect(menuKeys()).toEqual(['copy', 'closeWindow']);
  });

  test('Close window from the right-click closes that window', async () => {
    await renderOpenNow(seed(UNSORTED()));
    fireEvent.contextMenu(windowRow(2));

    fireEvent.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Close window',
      })
    );

    await waitFor(async () =>
      expect((await chrome.windows.getAll()).map((w) => w.id)).toEqual([1])
    );
  });

  test('a right-click on a tab row opens only the tab menu', async () => {
    await renderOpenNow(seed(UNSORTED()));

    fireEvent.contextMenu(
      within(blockOf(2)).getByRole('button', { name: 'Switch to tab: a21' })
    );

    expect(rowMenus()).toHaveLength(1);
    expect(rowMenus()[0]).toHaveAccessibleName('a21');
  });

  test('held: the strip shows while the right-click menu is open, and hides when it closes', async () => {
    await renderOpenNow(seed(UNSORTED()));
    expect(stripOpacity(2)).toBe('0');

    fireEvent.contextMenu(windowRow(2));
    expect(stripOpacity(2)).toBe('1');

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(stripOpacity(2)).toBe('0');
  });

  test('under a search the row gives Chrome its menu', async () => {
    const user = userEvent.setup();
    await renderOpenNow(seed(UNSORTED()));
    await user.type(
      screen.getByRole('textbox', { name: 'Search open tabs' }),
      'a2'
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Switch to tab: b22' })
      ).toBeNull()
    );

    expect(fireEvent.contextMenu(windowRow(2))).toBe(true);

    expect(rowMenus()).toHaveLength(0);
  });
});
