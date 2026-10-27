import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';

import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import OpenNowWindow from '../../components/home/opennow/OpenNowWindow';
import { Toast } from '../../components/common/Toast';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { toastTexts } from '../setup/toasts';
import {
  replaceState,
  type tabData,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  runShownHere,
  setHasTabGroupsPermission,
} from '../../redux/slices/globalStateSlice';
import { recordFirstRun } from '../../redux/slices/settingsDataStateSlice';
import { newRun } from '../../utils/functions/firstRun';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import type { OpenTab, OpenWindow } from '../../utils/functions/openNow';

// KAN-708 (4B). Right-clicking a tab row offers open or switch, Copy link, and delete or close; a saved tab also Rename tab (KAN-824).

const SUSPENDED =
  'chrome-extension://laameccjpleogmfhilmffpdbiibgbekf/suspended.html?title=Settings&url=chrome%3A%2F%2Fsettings%2F%3Fsearch%3Dzoom&time=1788746910025';

const tab = (tabId: string, url: string): tabData => ({
  tabId,
  favicon: '',
  title: `Title ${tabId}`,
  url,
});
const TABS = [
  tab('t1', 'https://a.test/'),
  tab('t2', SUSPENDED),
  tab('t3', 'https://c.test/'),
];

const menus = () => [
  ...document.querySelectorAll<HTMLElement>('[data-row-menu]'),
];
const labels = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('menuitem')
    .map((item) => {
      // The glyph's ligature text is aria-hidden; the label is what is left.
      const copy = item.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('[aria-hidden]').forEach((n) => n.remove());
      return copy.textContent;
    });

const clipboard = (writeText: (text: string) => Promise<void>) => {
  const spy = vi.fn(writeText);
  // jsdom has no clipboard to spy on, so one is defined and removed again.
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: spy },
    configurable: true,
  });
  return spy;
};

afterEach(() => {
  // Ends any double-click tail a Close tab choice left held.
  fireEvent.keyDown(document.body, { key: 'a' });
  Reflect.deleteProperty(navigator, 'clipboard');
  vi.restoreAllMocks();
});

const SAVED_ID = 'tg1';

async function renderSaved(tabGroupId = SAVED_ID) {
  return renderWithProviders(
    <>
      <WindowEntryContainer
        number={1}
        title="Window 1"
        tabGroupId={tabGroupId}
        windowId="w1"
        tabs={TABS}
        onOpenWindow={() => undefined}
        onUpdateWindowGroupTitle={() => undefined}
        onAddCurrTabToWindowClick={() => undefined}
        onDeleteClick={() => undefined}
      />
      <Toast />
    </>,
    {
      // tabs.create needs an active tab to sit beside, in a declared window.
      seed: {
        windows: [{ id: 1 }],
        tabs: [{ id: 1, active: true, url: 'https://added.test' }],
      },
      seedStore: (store) => {
        store.dispatch(
          replaceState(
            buildContainer([
              buildSession({
                tabGroupId,
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
                  },
                ],
              }),
            ])
          )
        );
      },
    }
  );
}

const savedRow = (title: string) =>
  screen.getByRole('button', { name: `Open in new tab: ${title}` });

describe('a saved tab row right-click (KAN-708)', () => {
  test('saved tab: Open in new tab, Rename tab, Copy link, Delete tab, in that order', async () => {
    await renderSaved();

    expect(fireEvent.contextMenu(savedRow('Title t1'))).toBe(false);

    expect(menus()).toHaveLength(1);
    expect(menus()[0]).toHaveAccessibleName('Title t1');
    expect(labels(menus()[0])).toEqual([
      'Open in new tab',
      'Rename tab',
      'Copy link',
      'Delete tab',
    ]);
  });

  test('saved tab while the tour blocks opens: no Open in new tab', async () => {
    const { store } = await renderSaved('sample:x');

    // A menu already open when the tour starts: a fresh right-click is suppressed while it runs.
    fireEvent.contextMenu(savedRow('Title t1'));
    expect(labels(menus()[0])).toContain('Open in new tab');
    act(() => {
      store.dispatch(
        recordFirstRun({ ...newRun('popup', 6), sessionId: 'sample:x' })
      );
      store.dispatch(runShownHere());
    });

    expect(labels(menus()[0])).toEqual([
      'Rename tab',
      'Copy link',
      'Delete tab',
    ]);
  });

  test('Copy link toasts "1 link copied."', async () => {
    const writeText = clipboard(() => Promise.resolve());
    const { store } = await renderSaved();

    fireEvent.contextMenu(savedRow('Title t1'));
    fireEvent.click(
      within(menus()[0]).getByRole('menuitem', { name: /^Copy link/ })
    );

    expect(await screen.findByText('1 link copied.')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledExactlyOnceWith('https://a.test/');
    expect(toastTexts(store.getState())).toEqual([
      TOAST_MESSAGES.COPY_LINKS_SUCCESS,
    ]);
  });

  test('a suspended tab copies the address it stands for', async () => {
    const writeText = clipboard(() => Promise.resolve());
    await renderSaved();

    fireEvent.contextMenu(savedRow('Title t2'));
    fireEvent.click(
      within(menus()[0]).getByRole('menuitem', { name: /^Copy link/ })
    );

    await screen.findByText('1 link copied.');
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      'chrome://settings/?search=zoom'
    );
  });

  test('a refused copy shows no toast', async () => {
    const writeText = clipboard(() =>
      Promise.reject(new DOMException('no', 'NotAllowedError'))
    );
    const { store } = await renderSaved();

    fireEvent.contextMenu(savedRow('Title t1'));
    fireEvent.click(
      within(menus()[0]).getByRole('menuitem', { name: /^Copy link/ })
    );
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });

    expect(toastTexts(store.getState())).toEqual([]);
  });

  test('Delete tab deletes that tab', async () => {
    const { store } = await renderSaved();

    fireEvent.contextMenu(savedRow('Title t2'));
    fireEvent.click(
      within(menus()[0]).getByRole('menuitem', { name: /^Delete tab/ })
    );

    expect(
      store
        .getState()
        .tabContainerDataState.tabGroups[0].windows[0].tabs.map((t) => t.tabId)
    ).toEqual(['t1', 't3']);
  });

  test('Open in new tab opens that tab beside the active one', async () => {
    const { chrome } = await renderSaved();

    fireEvent.contextMenu(savedRow('Title t1'));
    fireEvent.click(
      within(menus()[0]).getByRole('menuitem', { name: /^Open in new tab/ })
    );

    await vi.waitFor(() => expect(chrome.createdTabs).toHaveLength(1));
    expect(chrome.createdTabs[0]).toMatchObject({ url: 'https://a.test/' });
  });

  test('held: the tab row and its strip show while its menu is open', async () => {
    await renderSaved();
    const row = savedRow('Title t1').closest<HTMLElement>(
      '[data-drag-handle-row]'
    );
    const strip = row?.querySelector<HTMLElement>('[data-row-actions]');
    const control = strip?.firstElementChild;
    if (!row || !strip || !control) throw new Error('no tab row');
    expect(getComputedStyle(control).opacity).toBe('0');
    expect(getComputedStyle(row).backgroundColor).toBe('rgba(0, 0, 0, 0)');

    fireEvent.contextMenu(savedRow('Title t1'));

    expect(getComputedStyle(control).opacity).toBe('1');
    expect(getComputedStyle(row).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    // Only the right-clicked row is held.
    const other = savedRow('Title t3').closest<HTMLElement>(
      '[data-drag-handle-row]'
    );
    expect(
      getComputedStyle(
        other?.querySelector<HTMLElement>('[data-row-actions]')
          ?.firstElementChild as Element
      ).opacity
    ).toBe('0');
  });
});

const openTab = (id: number, extra: Partial<OpenTab> = {}): OpenTab => ({
  id,
  windowId: 7,
  title: `Live ${id}`,
  url: `https://live${id}.test/`,
  favIconUrl: '',
  active: false,
  pinned: false,
  audible: false,
  muted: false,
  groupId: null,
  index: id,
  ...extra,
});
const OPEN_TABS = [openTab(1, { active: true }), openTab(2), openTab(3)];
const OPEN_WINDOW: OpenWindow = {
  id: 7,
  isThisWindow: false,
  tabs: OPEN_TABS,
  groups: [],
  bounds: null,
  state: 'normal',
  incognito: false,
};

async function renderOpenNow(onCloseTab: (tab: OpenTab) => void) {
  return renderWithProviders(
    <>
      <OpenNowWindow
        openWindow={OPEN_WINDOW}
        number={2}
        lastUsedTabId={null}
        matchedTabIds={null}
        isOpen={true}
        onToggle={() => undefined}
        onCloseTab={onCloseTab}
        onSaveWindow={() => undefined}
        onSaveGroup={() => undefined}
        onUngroup={() => undefined}
        onCloseGroup={() => undefined}
      />
      <Toast />
    </>,
    {
      seed: {
        windows: [
          {
            id: 7,
            tabs: [{ id: 1, active: true }, { id: 2 }, { id: 3 }],
          },
        ],
      },
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(true));
      },
    }
  );
}

const liveRow = (title: string) =>
  screen.getByRole('button', { name: `Switch to tab: ${title}` });

describe('an Open now tab row right-click (KAN-708)', () => {
  test('Open now tab: Switch to tab, Copy link, Close tab; Close tab calls onCloseTab with that tab', async () => {
    const onCloseTab = vi.fn();
    await renderOpenNow(onCloseTab);

    expect(fireEvent.contextMenu(liveRow('Live 2'))).toBe(false);

    expect(menus()[0]).toHaveAccessibleName('Live 2');
    expect(labels(menus()[0])).toEqual([
      'Switch to tab',
      'Copy link',
      'Close tab',
    ]);
    fireEvent.click(
      within(menus()[0]).getByRole('menuitem', { name: /^Close tab/ })
    );
    expect(onCloseTab).toHaveBeenCalledExactlyOnceWith(OPEN_TABS[1]);
  });

  test('choosing Close tab holds back the double-click tail that would hit what slid up', async () => {
    await renderOpenNow(() => undefined);
    const tail = () =>
      new MouseEvent('click', { bubbles: true, cancelable: true, detail: 2 });
    // CONTROL: before the choice, a second click goes through.
    const before = tail();
    document.body.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);

    fireEvent.contextMenu(liveRow('Live 2'));
    fireEvent.click(
      within(menus()[0]).getByRole('menuitem', { name: /^Close tab/ })
    );
    const second = tail();
    document.body.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(true);
  });

  // KAN-804. Bringing a tab to the front draws what Go to window and Switch to session draw.
  test('Switch to tab draws filter_center_focus', async () => {
    await renderOpenNow(() => undefined);
    fireEvent.contextMenu(liveRow('Live 2'));

    const item = within(menus()[0]).getByRole('menuitem', {
      name: /^Switch to tab/,
    });
    expect(item.querySelector('[data-icon]')?.getAttribute('data-icon')).toBe(
      'filter_center_focus'
    );
  });

  test('Switch to tab activates that tab', async () => {
    await renderOpenNow(() => undefined);
    const update = vi.spyOn(globalThis.chrome.tabs, 'update');

    fireEvent.contextMenu(liveRow('Live 3'));
    fireEvent.click(
      within(menus()[0]).getByRole('menuitem', { name: /^Switch to tab/ })
    );

    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(3, { active: true });
  });

  test('Copy link toasts "1 link copied."', async () => {
    const writeText = clipboard(() => Promise.resolve());
    await renderOpenNow(() => undefined);

    fireEvent.contextMenu(liveRow('Live 2'));
    fireEvent.click(
      within(menus()[0]).getByRole('menuitem', { name: /^Copy link/ })
    );

    expect(await screen.findByText('1 link copied.')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledExactlyOnceWith('https://live2.test/');
  });

  test('a refused copy shows no toast', async () => {
    const writeText = clipboard(() =>
      Promise.reject(new DOMException('no', 'NotAllowedError'))
    );
    const { store } = await renderOpenNow(() => undefined);

    fireEvent.contextMenu(liveRow('Live 2'));
    fireEvent.click(
      within(menus()[0]).getByRole('menuitem', { name: /^Copy link/ })
    );
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });

    expect(toastTexts(store.getState())).toEqual([]);
  });

  test('held: the tab row and its strip show while its menu is open', async () => {
    await renderOpenNow(() => undefined);
    const row = liveRow('Live 2').closest<HTMLElement>(
      '[data-drag-handle-row]'
    );
    const control =
      row?.querySelector<HTMLElement>('[data-row-actions]')?.firstElementChild;
    if (!row || !control) throw new Error('no tab row');
    expect(getComputedStyle(control).opacity).toBe('0');
    expect(getComputedStyle(row).backgroundColor).toBe('rgba(0, 0, 0, 0)');

    fireEvent.contextMenu(liveRow('Live 2'));

    expect(getComputedStyle(control).opacity).toBe('1');
    expect(getComputedStyle(row).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  });
});

// KAN-824. Open now's tab rows show the address on hover, as saved tabs do.
describe('an Open now tab tooltip (KAN-824)', () => {
  test('is its address', async () => {
    await renderOpenNow(() => undefined);
    expect(liveRow('Live 2').getAttribute('data-tooltip')).toBe(
      'https://live2.test/'
    );
  });
});

describe('an Open now tab tooltip is not announced (KAN-824)', () => {
  test('no description from the address', async () => {
    await renderOpenNow(() => undefined);
    expect(liveRow('Live 2')).not.toHaveAttribute('aria-description');
  });
});

describe('a long Open now address is capped (KAN-824 final review)', () => {
  test('the tooltip keeps the start and cuts the middle', async () => {
    const long = `https://live.test/${'x'.repeat(2_000)}`;
    OPEN_TABS[1] = openTab(2, { url: long });
    try {
      await renderOpenNow(() => undefined);
      const tip = liveRow('Live 2').getAttribute('data-tooltip') ?? '';
      expect(tip.length).toBeLessThanOrEqual(301);
      expect(tip.startsWith('https://live.test/xxx')).toBe(true);
    } finally {
      OPEN_TABS[1] = openTab(2);
    }
  });
});
