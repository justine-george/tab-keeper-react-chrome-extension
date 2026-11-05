import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  runShownHere,
  setHasTabGroupsPermission,
  setSearchInputText,
} from '../../redux/slices/globalStateSlice';
import {
  recordFirstRun,
  setPinTabKeeperInNewWindows,
} from '../../redux/slices/settingsDataStateSlice';
import { newRun } from '../../utils/functions/firstRun';
import { SAMPLE_ID_PREFIX } from '../../utils/functions/sampleSession';
import {
  deleteTab,
  replaceState,
  type chromeTabGroupData,
  type tabData,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  RESTORE_SESSION_MESSAGE,
  type RestoreSessionRequest,
} from '../../utils/functions/windows';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-923. A saved tab's and group's Open in new window, right-click and ⋮.

afterEach(() => {
  history.replaceState(null, '', '/');
  fireEvent.keyDown(document.body, { key: 'Escape' });
});
beforeEach(() => localStorage.clear());

const t = (tabId: string, extra: Partial<tabData> = {}): tabData => ({
  tabId,
  favicon: '',
  title: tabId,
  url: `https://${tabId}.test/`,
  ...extra,
});
const TABS = [
  t('pin', { pinned: true }),
  t('loose'),
  t('g1a', { chromeGroupId: 'g1' }),
  t('g1b', { chromeGroupId: 'g1', pinned: true }),
];
const GROUPS: chromeTabGroupData[] = [
  { groupId: 'g1', title: 'Work', color: 'blue', collapsed: true },
];

type Store = Awaited<ReturnType<typeof renderWithProviders>>['store'];

async function render({
  incognito,
  sessionId = 'tg1',
  seedStore,
}: {
  incognito?: true;
  sessionId?: string;
  seedStore?: (store: Store) => void;
} = {}) {
  return renderWithProviders(
    <WindowEntryContainer
      number={1}
      title="Window 1"
      tabGroupId={sessionId}
      windowId="w1"
      tabs={TABS}
      chromeTabGroups={GROUPS}
      incognito={incognito}
      onOpenWindow={() => undefined}
      onUpdateWindowGroupTitle={() => undefined}
      onAddCurrTabToWindowClick={() => undefined}
      onDeleteClick={() => undefined}
    />,
    {
      seed: {
        grantedPermissions: ['tabGroups'],
        windows: [
          {
            id: 1,
            focused: true,
            tabs: [{ id: 11, url: 'https://live.test/', active: true }],
          },
        ],
      },
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(true));
        store.dispatch(
          replaceState(
            buildContainer([
              buildSession({
                tabGroupId: sessionId,
                windows: [
                  {
                    windowId: 'w1',
                    windowHeight: 700,
                    windowWidth: 900,
                    windowOffsetTop: 20,
                    windowOffsetLeft: 30,
                    tabCount: TABS.length,
                    title: 'Window 1',
                    tabs: TABS,
                    chromeTabGroups: GROUPS,
                    activeTabId: 'loose',
                    ...(incognito === undefined ? {} : { incognito }),
                  },
                ],
              }),
            ])
          )
        );
        seedStore?.(store);
      },
    }
  );
}

const rowMenu = () => {
  const menu = document.querySelector<HTMLElement>('[data-row-menu]');
  if (!menu) throw new Error('no right-click menu');
  return menu;
};
const listKeys = (menu: HTMLElement) =>
  [...menu.querySelectorAll(':scope > [data-menu-item]')].map((el) =>
    el.getAttribute('data-menu-item')
  );
const rightClickTab = (name: string) =>
  fireEvent.contextMenu(
    screen.getByRole('button', { name: `Open in new tab: ${name}` })
  );
const rightClickGroup = () =>
  fireEvent.contextMenu(
    screen.getByRole('button', { name: 'Rename group: Work' })
  );
const pressRow = () =>
  fireEvent.click(
    within(rowMenu()).getByRole('menuitem', { name: 'Open in new window' })
  );
const groupStrip = () => {
  const strip = screen
    .getByRole('button', { name: 'Rename group: Work' })
    .closest<HTMLElement>('[data-drag-handle-row]');
  if (!strip) throw new Error('no group row');
  return strip;
};
const seenRestores = (sent: unknown[]) =>
  sent.filter(
    (m): m is RestoreSessionRequest =>
      typeof m === 'object' &&
      m !== null &&
      Reflect.get(m, 'type') === RESTORE_SESSION_MESSAGE
  );
const oneRestore = async (sent: unknown[]) => {
  await waitFor(() => expect(seenRestores(sent)).toHaveLength(1));
  return seenRestores(sent)[0];
};

describe('where the row sits', () => {
  test('a saved tab: after Open in new tab, before Rename', async () => {
    await render();
    rightClickTab('loose');
    expect(listKeys(rowMenu())).toEqual([
      'open',
      'openNewWindow',
      'rename',
      'copy-link',
      'delete',
    ]);
  });

  test('a saved group, right-click: it leads, before Copy all links', async () => {
    await render();
    rightClickGroup();
    expect(listKeys(rowMenu()).slice(0, 2)).toEqual(['openNewWindow', 'copy']);
  });

  test('a saved group, ⋮: it leads there too', async () => {
    await render();
    fireEvent.click(
      within(groupStrip()).getByRole('button', { name: 'More actions' })
    );
    const items = within(screen.getByRole('menu'))
      .getAllByRole('menuitem')
      .map((i) => i.getAttribute('data-menu-item'));
    expect(items.slice(0, 2)).toEqual(['openNewWindow', 'copy']);
  });

  test('the tour leaves the row out', async () => {
    const r = await render({
      seedStore: (store) => {
        store.dispatch(
          recordFirstRun({ ...newRun('popup', 3), sessionId: 'tg1' })
        );
        store.dispatch(runShownHere());
      },
    });
    const kebabs = screen.getAllByRole('button', { name: 'More actions' });
    expect(kebabs).toHaveLength(2);
    for (const kebab of kebabs) {
      fireEvent.click(kebab);
      const items = within(screen.getByRole('menu'))
        .getAllByRole('menuitem')
        .map((i) => i.getAttribute('data-menu-item'));
      expect(items).not.toContain('openNewWindow');
      expect(items).toContain('copy');
      fireEvent.click(kebab);
    }
    expect(r.chrome.sentMessages).toEqual([]);
  });

  test('a saved tab under a held search keeps the row, and has no Rename', async () => {
    await render({
      seedStore: (store) => {
        store.dispatch(setSearchInputText('loose'));
      },
    });
    await act(async () => {});
    rightClickTab('loose');
    expect(listKeys(rowMenu())).toEqual([
      'open',
      'openNewWindow',
      'copy-link',
      'delete',
    ]);
  });
});

describe('what a press opens', () => {
  test('a tab: a focused normal window of that tab, by the worker', async () => {
    const r = await render();
    rightClickTab('g1a');
    pressRow();
    const { specs } = await oneRestore(r.chrome.sentMessages);
    expect(specs).toEqual([
      {
        tabs: [expect.objectContaining({ tabId: 'g1a' })],
        focused: true,
        bounds: null,
      },
    ]);
  });

  test('a group: its tabs in saved order, still a group', async () => {
    const r = await render();
    rightClickGroup();
    pressRow();
    const [spec] = (await oneRestore(r.chrome.sentMessages)).specs;
    expect(spec.tabs.map((tab) => tab.tabId)).toEqual(['g1a', 'g1b']);
    expect(spec.groups?.[0].title).toBe('Work');
  });

  test('a tab of a window saved incognito: still a normal window, as the row says', async () => {
    const r = await render({ incognito: true });
    rightClickTab('loose');
    pressRow();
    const { specs } = await oneRestore(r.chrome.sentMessages);
    expect(specs[0]).not.toHaveProperty('incognito');
  });

  test('a tab deleted while its menu is open opens nothing', async () => {
    const r = await render();
    rightClickTab('loose');
    act(() => {
      r.store.dispatch(
        deleteTab({ tabGroupId: 'tg1', windowId: 'w1', tabId: 'loose' })
      );
    });
    pressRow();
    await act(async () => {});
    expect(r.chrome.sentMessages).toEqual([]);
  });
});

describe('what a press leaves behind', () => {
  test('it counts as a restore, as Open does', async () => {
    const r = await render();
    rightClickTab('loose');
    pressRow();
    await oneRestore(r.chrome.sentMessages);
    expect(
      r.store.getState().settingsDataState.pendingReviewAsk?.moment.kind
    ).toBe('restored');
  });

  test('not on the sample session', async () => {
    const r = await render({ sessionId: `${SAMPLE_ID_PREFIX}x` });
    rightClickTab('loose');
    pressRow();
    await oneRestore(r.chrome.sentMessages);
    expect(r.store.getState().settingsDataState.pendingReviewAsk).toBeNull();
  });

  test('the request carries Pin Tab Keeper in new windows', async () => {
    const r = await render({
      seedStore: (store) => {
        store.dispatch(setPinTabKeeperInNewWindows(true));
      },
    });
    rightClickTab('loose');
    pressRow();
    expect((await oneRestore(r.chrome.sentMessages)).pinTabKeeper).toBe(true);
  });
});
