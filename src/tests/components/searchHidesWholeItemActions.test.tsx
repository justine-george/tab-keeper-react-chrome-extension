import { afterEach, describe, expect, test, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import MainContainer from '../../components/MainContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { RenderWithProvidersResult } from '../setup/renderWithProviders';
import {
  setHasTabGroupsPermission,
  setSearchInputText,
} from '../../redux/slices/globalStateSlice';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import type { tabContainerData } from '../../redux/slices/tabContainerDataStateSlice';
import { buildSession } from '../fixtures/sessionFixture';

// KAN-385 H1/H2/H3. While searching, only what opens, adds to or deletes a
// whole session, window or group is hidden. Renames, collapse, the colour
// picker and a tab's own open/delete stay.

const QUERY = 'needle';

const session = (): tabContainerData =>
  buildSession({
    tabGroupId: 'r',
    title: 'Research',
    windowCount: 2,
    tabCount: 4,
    windows: [
      {
        windowId: 'w1',
        windowHeight: 100,
        windowWidth: 100,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: 3,
        title: 'Morning reading',
        chromeTabGroups: [{ groupId: 'g1', title: 'Reading', color: 'blue' }],
        tabs: [
          {
            tabId: 't1',
            favicon: '',
            title: 'needle loose',
            url: 'https://a.test/',
          },
          {
            tabId: 't2',
            favicon: '',
            title: 'needle grouped',
            url: 'https://b.test/',
            chromeGroupId: 'g1',
          },
        ],
      },
      {
        windowId: 'w2',
        windowHeight: 100,
        windowWidth: 100,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: 1,
        title: 'Evening',
        tabs: [
          {
            tabId: 't3',
            favicon: '',
            title: 'needle other',
            url: 'https://c.test/',
          },
        ],
      },
    ],
  });

const render = (text: string) =>
  renderWithProviders(<MainContainer />, {
    seedStore: (store) => {
      store.dispatch(setHasTabGroupsPermission(true));
      store.dispatch(saveToTabContainerInternal(session()));
      store.dispatch(selectTabContainer('r'));
      store.dispatch(setSearchInputText(text));
    },
  });

const stored = (store: RenderWithProvidersResult['store']) =>
  store.getState().tabContainerDataState.tabGroups[0];

const byName = (name: string | RegExp) =>
  screen.queryAllByRole('button', { name });

// The home header has a More actions menu of its own; these two are the
// session header's and each Chrome group's.
const itemMenus = () => [
  ...within(
    document.querySelector<HTMLElement>('[data-session-toolbar]') ??
      document.body
  ).queryAllByRole('button', { name: 'More actions' }),
  ...screen
    .queryAllByRole('group')
    .flatMap((g) =>
      within(g).queryAllByRole('button', { name: 'More actions' })
    ),
];

// Whole-item actions: absent while searching. The strings are the accessible
// names, which en re-maps from the keys the code passes.
const H1_NAMES = [
  'Open session, keeping current windows',
  'Close current windows and open this session',
  'Add current window',
  'Add current tab',
  'Delete window group',
  'Add current tab to group',
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('H1: what hides while searching', () => {
  test.each(H1_NAMES)('%s is absent', async (name) => {
    await render(QUERY);
    await screen.findByRole('button', { name: 'Collapse all windows' });

    expect(byName(name)).toEqual([]);
  });

  test('the session and group More actions menus are absent', async () => {
    await render(QUERY);
    await screen.findByRole('button', { name: 'Collapse all windows' });

    expect(itemMenus()).toEqual([]);
  });

  test.each(H1_NAMES)(
    'CONTROL: %s is present when not searching',
    async (name) => {
      await render('');
      await screen.findByRole('button', { name: 'Collapse all windows' });

      expect(byName(name).length).toBeGreaterThan(0);
    }
  );

  // R7: Open hides; the title stays the rename button.
  test("a window's Open is absent, and its title still renames", async () => {
    await render(QUERY);
    await screen.findByRole('button', { name: 'Collapse all windows' });

    expect(byName('Open in new window: Morning reading')).toEqual([]);
    expect(byName('Rename window: Morning reading')).toHaveLength(1);
  });

  test("CONTROL: a window's Open is present when not searching", async () => {
    await render('');
    await screen.findByRole('button', { name: 'Collapse all windows' });

    expect(byName('Open in new window: Morning reading')).toHaveLength(1);
  });

  test('a spaces-only query hides nothing', async () => {
    await render('   ');
    await screen.findByRole('button', { name: 'Collapse all windows' });

    for (const name of H1_NAMES) expect(byName(name).length).toBeGreaterThan(0);
    expect(itemMenus().length).toBeGreaterThan(1);
  });
});

describe('H2: what stays while searching', () => {
  test('the session header title renames', async () => {
    const user = userEvent.setup();
    const { store } = await render(QUERY);

    await user.click(
      await screen.findByRole('button', { name: 'Rename session: Research' })
    );
    const input = screen.getByDisplayValue('Research');
    await user.clear(input);
    await user.type(input, 'Renamed{Enter}');

    expect(stored(store).title).toBe('Renamed');
  });

  test('the session pencil renames, and its tick commits', async () => {
    const user = userEvent.setup();
    const { store } = await render(QUERY);

    await user.click(
      await screen.findByRole('button', { name: 'Rename session' })
    );
    const input = screen.getByDisplayValue('Research');
    await user.clear(input);
    await user.type(input, 'Via pencil');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(stored(store).title).toBe('Via pencil');
  });

  test('a window renames', async () => {
    const user = userEvent.setup();
    const { store } = await render(QUERY);

    await user.click(
      await screen.findByRole('button', {
        name: 'Rename window: Morning reading',
      })
    );
    const input = screen.getByDisplayValue('Morning reading');
    await user.clear(input);
    await user.type(input, 'Dawn{Enter}');

    expect(stored(store).windows[0].title).toBe('Dawn');
  });

  test('a Chrome group renames', async () => {
    const user = userEvent.setup();
    const { store } = await render(QUERY);

    await user.click(
      await screen.findByRole('button', { name: 'Rename group: Reading' })
    );
    const input = screen.getByRole('textbox', { name: /Rename group/ });
    await user.clear(input);
    await user.type(input, 'Papers{Enter}');

    expect(stored(store).windows[0].chromeTabGroups?.[0].title).toBe('Papers');
  });

  test('Collapse all toggles', async () => {
    const user = userEvent.setup();
    await render(QUERY);

    await user.click(
      await screen.findByRole('button', { name: 'Collapse all windows' })
    );

    expect(
      screen.getByRole('button', { name: 'Expand all windows' })
    ).toBeInTheDocument();
  });

  test("a tab's delete removes it", async () => {
    const user = userEvent.setup();
    const { store } = await render(QUERY);

    await user.click(
      (await screen.findAllByRole('button', { name: 'Delete tab' }))[0]
    );

    expect(stored(store).windows[0].tabs.map((t) => t.tabId)).not.toContain(
      't1'
    );
  });

  test('the colour picker opens', async () => {
    const user = userEvent.setup();
    await render(QUERY);

    await user.click(
      await screen.findByRole('button', { name: 'Change group color: Reading' })
    );

    expect(
      within(screen.getByRole('menu')).getAllByRole('menuitemradio')
    ).toHaveLength(9);
  });

  test('CONTROL: the same set is present with spaces only', async () => {
    await render('   ');

    for (const name of [
      'Rename session',
      'Rename window: Morning reading',
      'Rename group: Reading',
      'Collapse all windows',
      'Delete tab',
      'Change group color: Reading',
    ])
      expect(
        (await screen.findAllByRole('button', { name })).length
      ).toBeGreaterThan(0);
  });
});

describe('Review Focus 1 and 3', () => {
  const twoSessions = (store: RenderWithProvidersResult['store']) => {
    store.dispatch(setHasTabGroupsPermission(false));
    store.dispatch(
      saveToTabContainerInternal(
        buildSession({ tabGroupId: 'b', title: 'Research beta', createdAt: 1 })
      )
    );
    store.dispatch(
      saveToTabContainerInternal(
        buildSession({ tabGroupId: 'a', title: 'Research alpha', createdAt: 2 })
      )
    );
    store.dispatch(selectTabContainer('a'));
    store.dispatch(setSearchInputText('research'));
  };

  const renameAlphaOutOfTheMatch = async () => {
    const user = userEvent.setup();
    const errors = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { store } = await renderWithProviders(<MainContainer />, {
      seedStore: twoSessions,
    });
    await user.click(
      await screen.findByRole('button', {
        name: 'Rename session: Research alpha',
      })
    );
    const input = screen.getByDisplayValue('Research alpha');
    await user.clear(input);
    await user.type(input, 'Alpha{Enter}');
    return { store, errors };
  };

  const listedIds = () =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[data-saved-search] + div [data-drag-row-id]'
      ),
    ].map((r) => r.dataset.dragRowId);

  test('renaming the selected session out of the match drops its row and throws nothing', async () => {
    const { errors } = await renameAlphaOutOfTheMatch();

    expect(listedIds()).toEqual(['b']);
    expect(errors).not.toHaveBeenCalled();
  });

  test('renaming the selected session out of the match selects the next match', async () => {
    const { store } = await renameAlphaOutOfTheMatch();

    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe('b');
    expect(
      await screen.findByRole('button', {
        name: 'Rename session: Research beta',
      })
    ).toBeInTheDocument();
  });

  // KAN-496. Still on body: the header unmounts for one commit until the list selects the next match.
  test.fails(
    'renaming the selected session out of the match leaves focus on the next match title',
    async () => {
      await renameAlphaOutOfTheMatch();

      expect(document.activeElement).toBe(
        await screen.findByRole('button', {
          name: 'Rename session: Research beta',
        })
      );
    }
  );

  const twoSessionsByTab = (store: RenderWithProvidersResult['store']) => {
    store.dispatch(setHasTabGroupsPermission(false));
    const withTab = (id: string, tabTitle: string, at: number) =>
      buildSession({
        tabGroupId: id,
        title: `Session ${id}`,
        createdAt: at,
        windows: [
          {
            windowId: `w-${id}`,
            windowHeight: 100,
            windowWidth: 100,
            windowOffsetTop: 0,
            windowOffsetLeft: 0,
            tabCount: 1,
            title: 'Window',
            tabs: [
              {
                tabId: `t-${id}`,
                favicon: '',
                title: tabTitle,
                url: 'https://a.test/',
              },
            ],
          },
        ],
      });
    store.dispatch(saveToTabContainerInternal(withTab('b', 'needle b', 1)));
    store.dispatch(saveToTabContainerInternal(withTab('a', 'needle a', 2)));
    store.dispatch(selectTabContainer('a'));
    store.dispatch(setSearchInputText(QUERY));
  };

  test("deleting the selected session's last matching tab selects the next match", async () => {
    const user = userEvent.setup();
    const { store } = await renderWithProviders(<MainContainer />, {
      seedStore: twoSessionsByTab,
    });

    await user.click(await screen.findByRole('button', { name: 'Delete tab' }));

    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe('b');
  });

  test('deleting the last matching tab drops the session and shows the no-match line', async () => {
    const user = userEvent.setup();
    const errors = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    await renderWithProviders(<MainContainer />, {
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(false));
        store.dispatch(
          saveToTabContainerInternal(
            buildSession({
              tabGroupId: 'r',
              windows: [
                {
                  windowId: 'w',
                  windowHeight: 100,
                  windowWidth: 100,
                  windowOffsetTop: 0,
                  windowOffsetLeft: 0,
                  tabCount: 2,
                  title: 'Window',
                  tabs: [
                    {
                      tabId: 'x',
                      favicon: '',
                      title: 'needle',
                      url: 'https://a.test/',
                    },
                    {
                      tabId: 'y',
                      favicon: '',
                      title: 'plain',
                      url: 'https://b.test/',
                    },
                  ],
                },
              ],
            })
          )
        );
        store.dispatch(selectTabContainer('r'));
        store.dispatch(setSearchInputText(QUERY));
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Delete tab' }));

    expect(
      await screen.findByText('No saved tab matches "needle"')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Collapse all windows' })
    ).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });
});
