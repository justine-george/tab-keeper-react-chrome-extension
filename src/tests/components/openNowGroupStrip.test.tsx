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
import {
  setHasTabGroupsPermission,
  setSearchInputText,
} from '../../redux/slices/globalStateSlice';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';

// KAN-696. A live group's title row ends in a labeled Save and a ⋮ holding
// Ungroup, then Close group last, named by the group as its other controls are.

afterEach(() => {
  // Close group left its double-click hold up; a key ends it.
  fireEvent.keyDown(document.body, { key: 'Escape' });
  vi.restoreAllMocks();
});
beforeEach(() => localStorage.clear());

const tab = (
  id: number,
  extra: Partial<{ groupId: number; active: boolean }> = {}
) => ({ id, title: `t${id}`, url: `https://h${id}.test/`, ...extra });

// Window 2: a loose tab, then Docs (22, 23), then an unnamed group (24).
const seed = (extra: Partial<ChromeSeed> = {}): ChromeSeed => ({
  grantedPermissions: ['tabGroups'],
  // Refused, so Reopen recreates rather than going to the worker.
  refusedPermissions: ['sessions'],
  windows: [
    { id: 1, focused: true, tabs: [tab(11, { active: true })] },
    {
      id: 2,
      tabs: [
        tab(21, { active: true }),
        tab(22, { groupId: 50 }),
        tab(23, { groupId: 50 }),
        tab(24, { groupId: 51 }),
      ],
    },
  ],
  tabGroups: [
    { id: 50, windowId: 2, title: 'Docs', color: 'blue' },
    { id: 51, windowId: 2, title: '', color: 'red' },
  ],
  ...extra,
});

async function renderOpenNow(chromeSeed: ChromeSeed = seed()) {
  const result = await renderWithProviders(
    <>
      <OpenNowColumn folded={true} />
      <Toast />
    </>,
    {
      seed: chromeSeed,
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(true));
      },
    }
  );
  await screen.findAllByRole('button', { name: /^Switch to tab: / });
  return result;
}

const titleRowOf = (name: string): HTMLElement => {
  const band = screen.getByRole('group', { name });
  const row = band.querySelector<HTMLElement>('[data-group-drag-handle]');
  if (!row) throw new Error('no title row');
  return row;
};

const stripIn = (row: HTMLElement) =>
  row.querySelector<HTMLElement>('[data-row-actions]');

const labelsIn = (strip: HTMLElement | null) =>
  strip
    ? within(strip)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label'))
    : null;

const menuKeys = () =>
  within(screen.getByRole('menu'))
    .getAllByRole('menuitem')
    .map((i) => i.getAttribute('data-menu-item'));

const groupIdsOfWindow2 = async () =>
  (await chrome.tabs.query({ windowId: 2 }))
    .sort((x, y) => x.index - y.index)
    .map((t) => [t.id, t.groupId]);

async function openGroupMenu(
  user: ReturnType<typeof userEvent.setup>,
  groupName: string
) {
  await user.click(
    screen.getByRole('button', { name: `More actions: ${groupName}` })
  );
}

describe('a live group row: Save and a ⋮ (KAN-696)', () => {
  test('the strip is Save group as a session, then More actions, named by the group', async () => {
    await renderOpenNow();
    const strip = stripIn(titleRowOf('Docs'));
    expect(labelsIn(strip)).toEqual([
      'Save group as a session: Docs',
      'More actions: Docs',
    ]);
    expect(
      within(strip as HTMLElement).getByRole('button', {
        name: 'Save group as a session: Docs',
      })
    ).toHaveTextContent('Save');
  });

  // KAN-780. A window's Save saves that one window, so it wears Save current window's glyph; a group's keeps add_box.
  test("a window's Save draws window_add; a group's Save keeps add_box", async () => {
    await renderOpenNow();
    const glyphOf = (button: HTMLElement) =>
      button.querySelector('[data-icon]')?.getAttribute('data-icon');

    expect(
      glyphOf(
        screen.getAllByRole('button', {
          name: /^Save window as a session: /,
        })[0]
      )
    ).toBe('window_add');
    expect(
      glyphOf(
        screen.getByRole('button', { name: 'Save group as a session: Docs' })
      )
    ).toBe('add_box');
  });

  test('an unnamed group names both controls Unnamed group', async () => {
    await renderOpenNow();
    expect(labelsIn(stripIn(titleRowOf('Unnamed group')))).toEqual([
      'Save group as a session: Unnamed group',
      'More actions: Unnamed group',
    ]);
  });

  test('the menu lists Ungroup, then Close group last', async () => {
    const user = userEvent.setup();
    await renderOpenNow();
    await openGroupMenu(user, 'Docs');
    expect(menuKeys()).toEqual(['ungroup', 'closeGroup']);
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    expect(items[items.length - 1]).toHaveTextContent('Close group');
  });

  test('Save adds one session named for the group with only its tabs, and closes nothing', async () => {
    const user = userEvent.setup();
    const { store } = await renderOpenNow();
    await user.click(
      screen.getByRole('button', { name: 'Save group as a session: Docs' })
    );
    await waitFor(() =>
      expect(store.getState().tabContainerDataState.tabGroups).toHaveLength(1)
    );
    const saved = store.getState().tabContainerDataState.tabGroups[0];
    expect(saved.title).toBe('Docs');
    expect(saved.windows).toHaveLength(1);
    expect(saved.windows[0].tabs.map((t) => t.title)).toEqual(['t22', 't23']);
    expect(await screen.findByText('Group saved as a session.')).toBeVisible();
    expect(await groupIdsOfWindow2()).toEqual([
      [21, -1],
      [22, 50],
      [23, 50],
      [24, 51],
    ]);
    expect(await chrome.tabGroups.query({ windowId: 2 })).toHaveLength(2);
  });

  test('Save names the session for a rename the snapshot has not caught up with', async () => {
    const user = userEvent.setup();
    const { store } = await renderOpenNow();
    const save = screen.getByRole('button', {
      name: 'Save group as a session: Docs',
    });
    // Chrome has the new title; the pane's read, 50 ms behind, still says Docs.
    await act(async () => {
      await chrome.tabGroups.update(50, { title: 'Reading' });
    });
    await user.click(save);
    await waitFor(() =>
      expect(store.getState().tabContainerDataState.tabGroups).toHaveLength(1)
    );
    expect(store.getState().tabContainerDataState.tabGroups[0].title).toBe(
      'Reading'
    );
  });

  test('Ungroup leaves every tab at its index with no group, and shows no toast', async () => {
    const user = userEvent.setup();
    await renderOpenNow();
    await openGroupMenu(user, 'Docs');
    await user.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Ungroup',
      })
    );
    await waitFor(async () =>
      expect(await groupIdsOfWindow2()).toEqual([
        [21, -1],
        [22, -1],
        [23, -1],
        [24, 51],
      ])
    );
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  test('Close group closes its tabs, says so, and Reopen brings them back grouped', async () => {
    const user = userEvent.setup();
    await renderOpenNow();
    await openGroupMenu(user, 'Docs');
    await user.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Close group',
      })
    );
    expect(await screen.findByText('Group closed (2 tabs).')).toBeVisible();
    await waitFor(async () =>
      expect((await groupIdsOfWindow2()).map(([id]) => id)).toEqual([21, 24])
    );
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(async () => {
      const rows = await groupIdsOfWindow2();
      expect(rows).toHaveLength(4);
      const reopened = rows.filter(([id]) => id !== 21 && id !== 24);
      expect(reopened[0][1]).not.toBe(-1);
      expect(reopened[0][1]).toBe(reopened[1][1]);
    });
  });

  test('choosing Close group holds back the double-click tail that would hit what slid up', async () => {
    const user = userEvent.setup();
    await renderOpenNow();
    await openGroupMenu(user, 'Docs');
    await user.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Close group',
      })
    );
    const second = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      detail: 2,
    });
    document.body.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(true);
  });

  const chevronOf = (windowId: number) =>
    within(
      document.querySelector(
        `[data-open-window-id="${windowId}"]`
      ) as HTMLElement
    ).getAllByRole('button')[0];

  test('Ungroup keeps focus in its window, on the chevron, as the ⋮ goes', async () => {
    const user = userEvent.setup();
    await renderOpenNow();
    await openGroupMenu(user, 'Docs');
    await user.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Ungroup',
      })
    );
    await waitFor(async () =>
      expect((await groupIdsOfWindow2())[1]).toEqual([22, -1])
    );
    expect(document.activeElement).toBe(chevronOf(2));
  });

  test('Close group focuses its own window chevron when the window survives', async () => {
    const user = userEvent.setup();
    await renderOpenNow();
    await openGroupMenu(user, 'Docs');
    await user.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Close group',
      })
    );
    await screen.findByText('Group closed (2 tabs).');
    expect(document.activeElement).toBe(chevronOf(2));
  });

  test('Close group on a window made only of that group focuses the next window, not the body', async () => {
    const user = userEvent.setup();
    await renderOpenNow(
      seed({
        windows: [
          { id: 1, focused: true, tabs: [tab(11, { active: true })] },
          {
            id: 2,
            tabs: [
              tab(22, { groupId: 50, active: true }),
              tab(23, { groupId: 50 }),
            ],
          },
          { id: 3, tabs: [tab(31, { active: true })] },
        ],
        tabGroups: [{ id: 50, windowId: 2, title: 'Docs', color: 'blue' }],
      })
    );
    await openGroupMenu(user, 'Docs');
    await user.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Close group',
      })
    );
    await screen.findByText('Group closed (2 tabs).');
    await waitFor(() =>
      expect(document.querySelector('[data-open-window-id="2"]')).toBeNull()
    );
    expect(document.activeElement).toBe(chevronOf(3));
  });

  test('a held Open now search renders no group strip', async () => {
    const user = userEvent.setup();
    await renderOpenNow();
    await user.type(
      screen.getByRole('textbox', { name: 'Search open tabs' }),
      't22'
    );
    expect(screen.queryByRole('button', { name: /^Save group as/ })).toBeNull();
    expect(
      screen.queryByRole('button', { name: /^More actions: Docs/ })
    ).toBeNull();
  });

  test('a held saved-list search renders no Save but keeps the ⋮', async () => {
    const { store } = await renderOpenNow();
    await act(async () => {
      store.dispatch(setSearchInputText('zzz'));
    });
    expect(labelsIn(stripIn(titleRowOf('Docs')))).toEqual([
      'More actions: Docs',
    ]);
  });

  test('while the menu is open the strip stays shown, and sits above the rows below', async () => {
    const user = userEvent.setup();
    await renderOpenNow();
    const strip = () => stripIn(titleRowOf('Docs')) as HTMLElement;
    const opacity = () =>
      getComputedStyle(strip().firstElementChild as Element).opacity;
    expect(opacity()).toBe('0');
    const resting = getComputedStyle(strip()).zIndex;
    await openGroupMenu(user, 'Docs');
    await user.unhover(
      screen.getByRole('button', { name: 'More actions: Docs' })
    );
    expect(opacity()).toBe('1');
    expect(getComputedStyle(strip()).zIndex).not.toBe(resting);
    await act(async () => {
      await user.keyboard('{Escape}');
    });
    expect(opacity()).toBe('0');
    expect(getComputedStyle(strip()).zIndex).toBe(resting);
  });

  test('clicking the title still opens the rename field, and the strip is gone while editing', async () => {
    const user = userEvent.setup();
    await renderOpenNow();
    await user.click(
      screen.getByRole('button', { name: 'Rename group: Docs' })
    );
    expect(
      await screen.findByRole('textbox', { name: 'Rename group: Docs' })
    ).toBeVisible();
    expect(stripIn(titleRowOf('Docs'))).toBeNull();
  });

  test('clicking Save does not start a rename', async () => {
    const user = userEvent.setup();
    await renderOpenNow();
    await user.click(
      screen.getByRole('button', { name: 'Save group as a session: Docs' })
    );
    expect(screen.queryByRole('textbox', { name: /^Rename group/ })).toBeNull();
  });
});

// KAN-708. The group header's right-click offers what its ⋮ offers.
describe('a live group row right-click (KAN-708)', () => {
  const rowMenus = () => [
    ...document.querySelectorAll<HTMLElement>('[data-row-menu]'),
  ];
  const firstControl = () =>
    stripIn(titleRowOf('Docs'))?.firstElementChild as HTMLElement;

  test('right-click = Ungroup, Close group, acting on that group', async () => {
    await renderOpenNow();

    expect(fireEvent.contextMenu(titleRowOf('Docs'))).toBe(false);
    expect(menuKeys()).toEqual(['ungroup', 'closeGroup']);

    fireEvent.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Ungroup',
      })
    );
    await waitFor(async () =>
      expect(await groupIdsOfWindow2()).toEqual([
        [21, -1],
        [22, -1],
        [23, -1],
        [24, 51],
      ])
    );
  });

  test('a right-click on a group header opens the group menu only, not the window menu', async () => {
    await renderOpenNow();

    fireEvent.contextMenu(titleRowOf('Docs'));

    expect(rowMenus()).toHaveLength(1);
    expect(rowMenus()[0]).toHaveAccessibleName('More actions: Docs');
  });

  test('a right-click on a tab inside the group opens only the tab menu', async () => {
    await renderOpenNow();

    fireEvent.contextMenu(
      screen.getByRole('button', { name: 'Switch to tab: t22' })
    );

    expect(rowMenus()).toHaveLength(1);
    expect(rowMenus()[0]).toHaveAccessibleName('t22');
  });

  test('held: the strip shows while the right-click menu is open', async () => {
    await renderOpenNow();
    expect(getComputedStyle(firstControl()).opacity).toBe('0');

    fireEvent.contextMenu(titleRowOf('Docs'));
    expect(getComputedStyle(firstControl()).opacity).toBe('1');

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(getComputedStyle(firstControl()).opacity).toBe('0');
  });

  test('the right-click hold fills the header; the ⋮ open lifts the strip and leaves the header unfilled', async () => {
    await renderOpenNow();
    // jsdom answers :hover for a focused control, so the header's own rule is read, not its computed fill.
    const ownFills = () => {
      const own = `.${titleRowOf('Docs').className.split(' ').join('.')}`;
      return [...document.querySelectorAll('style')]
        .flatMap((s) => [...(s.sheet?.cssRules ?? [])])
        .filter(
          (r) =>
            r instanceof CSSStyleRule &&
            r.selectorText === own &&
            r.style.backgroundColor !== ''
        ).length;
    };
    expect(ownFills()).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'More actions: Docs' }));
    expect(screen.getByRole('menu')).toBeVisible();
    expect(getComputedStyle(firstControl()).opacity).toBe('1');
    expect(ownFills()).toBe(0);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.contextMenu(titleRowOf('Docs'));
    expect(ownFills()).toBe(1);
  });

  test('under an Open now search the header gives Chrome its menu', async () => {
    const user = userEvent.setup();
    await renderOpenNow();
    await user.type(
      screen.getByRole('textbox', { name: 'Search open tabs' }),
      't22'
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Switch to tab: t21' })
      ).toBeNull()
    );

    expect(fireEvent.contextMenu(titleRowOf('Docs'))).toBe(true);

    expect(rowMenus()).toHaveLength(0);
  });
});

describe('right-clicking an Open now group’s colour bar (KAN-708)', () => {
  test('opens the colour picker, not the group’s row menu', async () => {
    await renderOpenNow();
    const bar = screen.getByRole('button', {
      name: 'Change group color: Docs',
    });
    expect(fireEvent.contextMenu(bar)).toBe(false);
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(9);
    expect(screen.getAllByRole('menuitemradio')[0]).toHaveFocus();
    expect(document.querySelectorAll('[data-row-menu]')).toHaveLength(0);
  });
});

// KAN-746. A live group's ⋮ (and right-click) offers Sort tabs by site first,
// only while sorting would change that group's order.
describe('Sort tabs by site on a live group (KAN-746)', () => {
  // Docs holds a, b, a: out of order. The window's loose tab stays put.
  const unsorted = (): ChromeSeed =>
    seed({
      windows: [
        { id: 1, focused: true, tabs: [tab(11, { active: true })] },
        {
          id: 2,
          tabs: [
            tab(21, { active: true }),
            { id: 22, title: 'a1', url: 'https://a.test/1', groupId: 50 },
            { id: 23, title: 'b1', url: 'https://b.test/1', groupId: 50 },
            { id: 25, title: 'a2', url: 'https://a.test/2', groupId: 50 },
            tab(24, { groupId: 51 }),
          ],
        },
      ],
    });

  test('the menu lists Sort tabs by site first, then Ungroup, then Close group', async () => {
    const user = userEvent.setup();
    await renderOpenNow(unsorted());
    await openGroupMenu(user, 'Docs');
    expect(menuKeys()).toEqual(['sortBySite', 'ungroup', 'closeGroup']);
  });

  test("choosing it sorts the real group's tabs and says so", async () => {
    const user = userEvent.setup();
    await renderOpenNow(unsorted());
    await openGroupMenu(user, 'Docs');
    await user.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Sort tabs by site',
      })
    );
    await waitFor(async () =>
      expect(await groupIdsOfWindow2()).toEqual([
        [21, -1],
        [22, 50],
        [25, 50],
        [23, 50],
        [24, 51],
      ])
    );
    expect(await screen.findByText('Sorted the tabs by site.')).toBeVisible();
  });

  test('right-click offers it too', async () => {
    await renderOpenNow(unsorted());
    fireEvent.contextMenu(titleRowOf('Docs'));
    expect(menuKeys()).toEqual(['sortBySite', 'ungroup', 'closeGroup']);
  });

  test('absent for a sorted group', async () => {
    const user = userEvent.setup();
    await renderOpenNow();
    await openGroupMenu(user, 'Docs');
    expect(menuKeys()).toEqual(['ungroup', 'closeGroup']);
  });
});
