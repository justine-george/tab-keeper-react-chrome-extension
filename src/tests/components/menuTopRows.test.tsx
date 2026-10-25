import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import OpenNowColumn from '../../components/home/opennow/OpenNowColumn';
import { Toast } from '../../components/common/Toast';
import { renderWithProviders } from '../setup/renderWithProviders';
import { setupChromeFake, type ChromeSeed } from '../setup/chrome.fake';
import {
  setHasTabGroupsPermission,
  setSearchInputText,
} from '../../redux/slices/globalStateSlice';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  replaceState,
  type chromeTabGroupData,
  type tabData,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-793. A row's right-click leads with the row's own buttons; its ⋮ does not.

afterEach(() => {
  history.replaceState(null, '', '/');
  // Close window/group leave a double-click hold up; a key ends it.
  fireEvent.keyDown(document.body, { key: 'Escape' });
  vi.restoreAllMocks();
});
beforeEach(() => localStorage.clear());

const rowMenu = () => {
  const menus = document.querySelectorAll<HTMLElement>('[data-row-menu]');
  expect(menus).toHaveLength(1);
  return menus[0];
};
const actionRow = (menu: HTMLElement) =>
  menu.querySelector<HTMLElement>('[data-menu-action-row]');
// The top row by name; [] when there is none.
const rowNames = (menu: HTMLElement) => {
  const row = actionRow(menu);
  return row === null
    ? []
    : within(row)
        .getAllByRole('menuitem')
        .map((b) => b.getAttribute('aria-label'));
};
const rowDescriptions = (menu: HTMLElement) =>
  within(actionRow(menu) as HTMLElement)
    .getAllByRole('menuitem')
    .map((b) => b.getAttribute('aria-description'));
const listKeys = (menu: HTMLElement) =>
  [...menu.querySelectorAll(':scope > [data-menu-item]')].map((el) =>
    el.getAttribute('data-menu-item')
  );
const press = (menu: HTMLElement, name: string) =>
  fireEvent.click(
    within(actionRow(menu) as HTMLElement).getByRole('menuitem', { name })
  );

describe('a saved window and its groups', () => {
  const t = (tabId: string, url: string, chromeGroupId?: string): tabData => ({
    tabId,
    favicon: '',
    title: tabId,
    url,
    ...(chromeGroupId === undefined ? {} : { chromeGroupId }),
  });
  const TABS = [
    t('b1', 'https://b.test/'),
    t('a1', 'https://a.test/', 'g1'),
    t('c1', 'https://c.test/', 'g1'),
  ];
  const GROUPS: chromeTabGroupData[] = [
    { groupId: 'g1', title: 'Work', color: 'blue' },
  ];
  const live: ChromeSeed = {
    grantedPermissions: ['tabGroups'],
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 11, url: 'https://live.test/', title: 'Live', active: true },
        ],
      },
    ],
  };

  async function renderSaved() {
    const onOpenWindow = vi.fn();
    const onAddCurrTabToWindowClick = vi.fn();
    const result = await renderWithProviders(
      <WindowEntryContainer
        number={1}
        title="Window 1"
        tabGroupId="tg1"
        windowId="w1"
        tabs={TABS}
        chromeTabGroups={GROUPS}
        onOpenWindow={onOpenWindow}
        onUpdateWindowGroupTitle={() => undefined}
        onAddCurrTabToWindowClick={onAddCurrTabToWindowClick}
        onDeleteClick={() => undefined}
      />,
      {
        seed: live,
        seedStore: (store) => {
          store.dispatch(setHasTabGroupsPermission(true));
          store.dispatch(
            replaceState(
              buildContainer([
                buildSession({
                  tabGroupId: 'tg1',
                  windows: [
                    {
                      windowId: 'w1',
                      windowHeight: 1080,
                      windowWidth: 1920,
                      windowOffsetTop: 0,
                      windowOffsetLeft: 0,
                      tabCount: TABS.length,
                      title: 'Window 1',
                      tabs: TABS,
                      chromeTabGroups: GROUPS,
                    },
                  ],
                }),
              ])
            )
          );
        },
      }
    );
    return { ...result, onOpenWindow, onAddCurrTabToWindowClick };
  }
  const windowTitle = () =>
    screen.getByRole('button', { name: 'Rename window: Window 1' });
  const groupTitle = () =>
    screen.getByRole('button', { name: 'Rename group: Work' });
  const groupTabs = (store: Awaited<ReturnType<typeof renderSaved>>['store']) =>
    store
      .getState()
      .tabContainerDataState.tabGroups[0].windows[0].tabs.filter(
        (tab) => tab.chromeGroupId === 'g1'
      )
      .map((tab) => tab.url);

  test('popup: the window right-click leads with Open · Add tab · Rename, named short and described long', async () => {
    await renderSaved();
    fireEvent.contextMenu(windowTitle());

    expect(rowNames(rowMenu())).toEqual(['Open', 'Add tab', 'Rename']);
    expect(rowDescriptions(rowMenu())).toEqual([
      'Open in new window',
      'Add current tab',
      'Rename window',
    ]);
    expect(listKeys(rowMenu())).toEqual(['copy', 'sortBySite', 'delete']);
  });

  test('full view: no Add tab, as the row has none there', async () => {
    history.replaceState(null, '', '?view=tab');
    await renderSaved();
    fireEvent.contextMenu(windowTitle());

    expect(rowNames(rowMenu())).toEqual(['Open', 'Rename']);
  });

  test('the window ⋮ has no top row', async () => {
    const user = userEvent.setup();
    await renderSaved();
    await user.click(
      screen.getAllByRole('button', { name: 'More actions' })[0]
    );
    const menu = screen.getByRole('menu');

    expect(actionRow(menu)).toBeNull();
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.getAttribute('data-menu-item'))
    ).toEqual(['copy', 'sortBySite', 'delete']);
  });

  test('Open and Add tab run the row’s own buttons’ actions and close the menu', async () => {
    const { onOpenWindow, onAddCurrTabToWindowClick } = await renderSaved();
    fireEvent.contextMenu(windowTitle());
    press(rowMenu(), 'Open');
    fireEvent.contextMenu(windowTitle());
    press(rowMenu(), 'Add tab');

    expect(onOpenWindow).toHaveBeenCalledTimes(1);
    expect(onAddCurrTabToWindowClick).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-row-menu]')).toBeNull();
  });

  test('Rename opens the window’s name field with the focus in it', async () => {
    await renderSaved();
    fireEvent.contextMenu(windowTitle());
    press(rowMenu(), 'Rename');

    const field = await screen.findByPlaceholderText('Name this window');
    expect(field).toHaveFocus();
    expect(document.querySelector('[data-row-menu]')).toBeNull();
  });

  test('popup: the group right-click leads with Open · Add tab · Rename', async () => {
    await renderSaved();
    fireEvent.contextMenu(groupTitle());

    expect(rowNames(rowMenu())).toEqual(['Open', 'Add tab', 'Rename']);
    expect(rowDescriptions(rowMenu())).toEqual([
      'Open group',
      'Add current tab to group',
      'Rename group',
    ]);
    // Already in site order, so no Sort tabs by site.
    expect(listKeys(rowMenu())).toEqual(['copy', 'ungroup', 'delete']);
  });

  test('full view: the group row is Open · Rename', async () => {
    history.replaceState(null, '', '?view=tab');
    await renderSaved();
    fireEvent.contextMenu(groupTitle());

    expect(rowNames(rowMenu())).toEqual(['Open', 'Rename']);
  });

  test('the group’s Open opens its tabs', async () => {
    await renderSaved();
    fireEvent.contextMenu(groupTitle());
    press(rowMenu(), 'Open');

    await waitFor(async () =>
      expect((await chrome.tabs.query({})).map((tab) => tab.url)).toEqual([
        'https://live.test/',
        'https://a.test/',
        'https://c.test/',
      ])
    );
  });

  test('the group’s Add tab adds the current tab to that group', async () => {
    const { store } = await renderSaved();
    fireEvent.contextMenu(groupTitle());
    press(rowMenu(), 'Add tab');
    await waitFor(() =>
      // First in the group, as the strip's Add current tab puts it.
      expect(groupTabs(store)).toEqual([
        'https://live.test/',
        'https://a.test/',
        'https://c.test/',
      ])
    );
  });

  test('the group’s Rename opens its name field with the focus in it', async () => {
    await renderSaved();
    fireEvent.contextMenu(groupTitle());
    press(rowMenu(), 'Rename');

    expect(
      await screen.findByRole('textbox', { name: 'Rename group: Work' })
    ).toHaveFocus();
  });

  test('the group ⋮ has no top row', async () => {
    const user = userEvent.setup();
    await renderSaved();
    await user.click(
      screen.getAllByRole('button', { name: 'More actions' })[1]
    );

    expect(actionRow(screen.getByRole('menu'))).toBeNull();
  });
});

describe('Currently open windows and groups', () => {
  const tab = (
    id: number,
    extra: Partial<{ groupId: number; active: boolean }> = {}
  ) => ({ id, title: `t${id}`, url: `https://h${id}.test/`, ...extra });
  // As openNowSave.test.tsx: the extension's own address, read off a scratch fake.
  const tabViewUrl = () => {
    const scratch = setupChromeFake();
    const url = chrome.runtime.getURL('index.html') + '?view=tab';
    scratch.restore();
    return url;
  };
  // Window 1 holds the tab view, so it is This window; window 2 holds the group Docs.
  const seed = (): ChromeSeed => ({
    grantedPermissions: ['tabGroups'],
    currentTabId: 10,
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, url: tabViewUrl(), title: 'Tab Keeper', active: true },
          tab(12),
        ],
      },
      {
        id: 2,
        tabs: [
          tab(21, { active: true }),
          tab(22, { groupId: 50 }),
          tab(23, { groupId: 50 }),
        ],
      },
    ],
    tabGroups: [{ id: 50, windowId: 2, title: 'Docs', color: 'blue' }],
  });

  async function renderOpenNow({ savedSearch = false } = {}) {
    const result = await renderWithProviders(
      <>
        <OpenNowColumn folded={true} />
        <Toast />
      </>,
      {
        seed: seed(),
        seedStore: (store) => {
          store.dispatch(setHasTabGroupsPermission(true));
          if (savedSearch) store.dispatch(setSearchInputText('zzz'));
        },
      }
    );
    await screen.findAllByRole('button', { name: /^Switch to tab: / });
    return result;
  }
  const windowRow = (windowId: number) => {
    const row = document.querySelector<HTMLElement>(
      `[data-open-window-id="${windowId}"] [data-window-row]`
    );
    if (row === null) throw new Error('no window row');
    return row;
  };
  const groupRow = () => {
    const row = screen
      .getByRole('group', { name: 'Docs' })
      .querySelector<HTMLElement>('[data-group-drag-handle]');
    if (row === null) throw new Error('no group title row');
    return row;
  };
  const sessionsOf = (
    store: Awaited<ReturnType<typeof renderOpenNow>>['store']
  ) => store.getState().tabContainerDataState.tabGroups;

  test('a window’s right-click leads with Go to · Save', async () => {
    await renderOpenNow();
    fireEvent.contextMenu(windowRow(2));

    expect(rowNames(rowMenu())).toEqual(['Go to', 'Save']);
    expect(rowDescriptions(rowMenu())).toEqual([
      'Go to window',
      'Save window as a session',
    ]);
    expect(listKeys(rowMenu())).toEqual(['copy', 'sortBySite', 'closeWindow']);
  });

  test('This window’s right-click leads with Save alone: you are in it', async () => {
    await renderOpenNow();
    // PREMISE: window 1 is the one tagged This window.
    expect(within(windowRow(1)).getByText('This window')).toBeInTheDocument();
    fireEvent.contextMenu(windowRow(1));

    expect(rowNames(rowMenu())).toEqual(['Save']);
    expect(listKeys(rowMenu())).toEqual(['copy']);
  });

  test('Go to brings that window to the front', async () => {
    await renderOpenNow();
    fireEvent.contextMenu(windowRow(2));
    press(rowMenu(), 'Go to');

    await waitFor(async () =>
      expect((await chrome.windows.get(2)).focused).toBe(true)
    );
  });

  test('Save saves that window as a session', async () => {
    const { store } = await renderOpenNow();
    fireEvent.contextMenu(windowRow(2));
    press(rowMenu(), 'Save');

    await waitFor(() => expect(sessionsOf(store)).toHaveLength(1));
    expect(sessionsOf(store)[0].windows[0].tabs.map((t) => t.url)).toEqual([
      'https://h21.test/',
      'https://h22.test/',
      'https://h23.test/',
    ]);
  });

  test('while the saved list is searched, Save leaves the row as it leaves the strip; This window has no row', async () => {
    await renderOpenNow({ savedSearch: true });
    fireEvent.contextMenu(windowRow(2));
    expect(rowNames(rowMenu())).toEqual(['Go to']);
    fireEvent.keyDown(rowMenu(), { key: 'Escape' });

    fireEvent.contextMenu(windowRow(1));
    expect(actionRow(rowMenu())).toBeNull();
    expect(listKeys(rowMenu())).toEqual(['copy']);
  });

  test('a window ⋮ has no top row', async () => {
    const user = userEvent.setup();
    await renderOpenNow();
    await user.click(
      screen.getByRole('button', { name: 'More actions: Window 2' })
    );

    expect(actionRow(screen.getByRole('menu'))).toBeNull();
  });

  test('a group’s right-click leads with Save · Rename', async () => {
    await renderOpenNow();
    fireEvent.contextMenu(groupRow());

    expect(rowNames(rowMenu())).toEqual(['Save', 'Rename']);
    expect(rowDescriptions(rowMenu())).toEqual([
      'Save group as a session',
      'Rename group',
    ]);
    expect(listKeys(rowMenu())).toEqual(['copy', 'ungroup', 'closeGroup']);
  });

  test('the group’s Save saves only its tabs', async () => {
    const { store } = await renderOpenNow();
    fireEvent.contextMenu(groupRow());
    press(rowMenu(), 'Save');

    await waitFor(() => expect(sessionsOf(store)).toHaveLength(1));
    expect(sessionsOf(store)[0].windows[0].tabs.map((t) => t.url)).toEqual([
      'https://h22.test/',
      'https://h23.test/',
    ]);
  });

  test('the group’s Rename opens its name field with the focus in it', async () => {
    await renderOpenNow();
    fireEvent.contextMenu(groupRow());
    press(rowMenu(), 'Rename');

    expect(
      await screen.findByRole('textbox', { name: 'Rename group: Docs' })
    ).toHaveFocus();
  });

  test('a group ⋮ has no top row', async () => {
    const user = userEvent.setup();
    await renderOpenNow();
    await user.click(
      screen.getByRole('button', { name: 'More actions: Docs' })
    );

    expect(actionRow(screen.getByRole('menu'))).toBeNull();
  });

  test('worst path: Go to on a window Chrome has just closed does nothing and throws nothing', async () => {
    await renderOpenNow();
    fireEvent.contextMenu(windowRow(2));
    await chrome.windows.remove(2);
    press(rowMenu(), 'Go to');

    await waitFor(async () =>
      expect((await chrome.windows.getAll()).map((w) => w.id)).toEqual([1])
    );
  });
});
