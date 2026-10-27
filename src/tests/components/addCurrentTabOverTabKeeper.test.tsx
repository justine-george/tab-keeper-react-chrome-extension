import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';

import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  replaceState,
  type chromeTabGroupData,
  type tabData,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-823. Over a Tab Keeper page the popup offers no Add current tab: the add
// would be refused (KAN-299), so the window's icon, the group's icon and both
// right-click menus' Add tab are not drawn. Over an ordinary page they are.

afterEach(() => {
  // A right-click menu left open would leak into the next test.
  fireEvent.keyDown(document.body, { key: 'Escape' });
  vi.restoreAllMocks();
});

const t = (tabId: string, url: string, chromeGroupId?: string): tabData => ({
  tabId,
  favicon: '',
  title: tabId,
  url,
  ...(chromeGroupId === undefined ? {} : { chromeGroupId }),
});
const TABS = [t('b1', 'https://b.test/'), t('a1', 'https://a.test/', 'g1')];
const GROUPS: chromeTabGroupData[] = [
  { groupId: 'g1', title: 'Work', color: 'blue' },
];

// `before` runs once the chrome fake is in place, before the row mounts.
async function renderOver(currentUrl: string, before = () => {}) {
  const live: ChromeSeed = {
    grantedPermissions: ['tabGroups'],
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 11, url: currentUrl, title: 'Current', active: true }],
      },
    ],
  };
  const result = await renderWithProviders(
    <WindowEntryContainer
      number={1}
      title="Window 1"
      tabGroupId="tg1"
      windowId="w1"
      tabs={TABS}
      chromeTabGroups={GROUPS}
      onOpenWindow={() => undefined}
      onUpdateWindowGroupTitle={() => undefined}
      onAddCurrTabToWindowClick={() => undefined}
      onDeleteClick={() => undefined}
    />,
    {
      seed: live,
      seedStore: (store) => {
        before();
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
  // The popup's one question about the current tab, answered.
  await act(async () => {});
  return result;
}

const windowIcon = () => screen.queryByLabelText('Add current tab');
const groupIcon = () => screen.queryByLabelText('Add current tab to group');
// The right-click menu's top row, by name.
const topRowOf = (target: HTMLElement) => {
  fireEvent.contextMenu(target);
  const menu = document.querySelector<HTMLElement>('[data-row-menu]');
  const row = menu?.querySelector<HTMLElement>('[data-menu-action-row]');
  if (!row) throw new Error('no right-click top row');
  const names = within(row)
    .getAllByRole('menuitem')
    .map((b) => b.getAttribute('aria-label'));
  fireEvent.keyDown(document.body, { key: 'Escape' });
  return names;
};
const windowTitle = () =>
  screen.getByRole('button', { name: 'Rename window: Window 1' });
const groupTitle = () =>
  screen.getByRole('button', { name: 'Rename group: Work' });

describe('KAN-823 Add current tab over a Tab Keeper page', () => {
  test('over the tab view: no icon and no right-click Add tab, window or group', async () => {
    await renderOver('chrome-extension://faketestid/index.html?view=tab');
    expect(windowIcon()).toBeNull();
    expect(groupIcon()).toBeNull();
    expect(topRowOf(windowTitle())).toEqual(['Open', 'Rename']);
    expect(topRowOf(groupTitle())).not.toContain('Add tab');
  });

  test('over the popup page itself: hidden too', async () => {
    await renderOver('chrome-extension://faketestid/index.html');
    expect(windowIcon()).toBeNull();
    expect(groupIcon()).toBeNull();
  });

  test('offered until the popup has its answer', async () => {
    await renderOver('chrome-extension://faketestid/index.html', () => {
      vi.spyOn(chrome.tabs, 'query').mockImplementation(
        () => new Promise<chrome.tabs.Tab[]>(() => {})
      );
    });
    expect(windowIcon()).not.toBeNull();
    expect(groupIcon()).not.toBeNull();
  });

  test('a question that fails still offers it, and the handler decides', async () => {
    await renderOver('chrome-extension://faketestid/index.html', () => {
      vi.spyOn(chrome.tabs, 'query').mockImplementation(() =>
        Promise.reject(new Error('no tabs'))
      );
    });
    expect(windowIcon()).not.toBeNull();
    expect(groupIcon()).not.toBeNull();
  });

  test('CONTROL: over an ordinary page every Add current tab shows', async () => {
    await renderOver('https://live.test/');
    expect(windowIcon()).not.toBeNull();
    expect(groupIcon()).not.toBeNull();
    expect(topRowOf(windowTitle())).toEqual(['Open', 'Add tab', 'Rename']);
    expect(topRowOf(groupTitle())).toContain('Add tab');
  });
});
