import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';

import RightPane from '../../components/home/rightpane/RightPane';
import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import { OpenCopiesProvider } from '../../components/home/rightpane/OpenCopiesProvider';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import type {
  chromeTabGroupData,
  tabData,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  runShownHere,
  setHasTabGroupsPermission,
} from '../../redux/slices/globalStateSlice';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { buildSession } from '../fixtures/sessionFixture';
import { recordFirstRun } from '../../redux/slices/settingsDataStateSlice';
import { newRun } from '../../utils/functions/firstRun';

// KAN-885. A saved group's Open switches to an open group with the same name,
// tab count and addresses; it says Go to group while one is open. Middle-click,
// ⌘/Ctrl-click and the menu's Open always open a copy.

const TABS: tabData[] = [
  { tabId: 'loose', favicon: '', title: 'Loose', url: 'https://a.test/' },
  {
    tabId: 'g1',
    favicon: '',
    title: 'One',
    url: 'https://b.test/',
    chromeGroupId: 'grp',
  },
  {
    tabId: 'g2',
    favicon: '',
    title: 'Two',
    url: 'https://c.test/',
    chromeGroupId: 'grp',
  },
];
const GROUPS: chromeTabGroupData[] = [
  { groupId: 'grp', title: 'Research', color: 'blue' },
];

// Tab Keeper's window 1 in front; window 2 holds Research, reordered and
// recoloured, behind its own active tab. Tab 22 was used last.
const seed = (platformOs: 'mac' | 'linux' = 'linux'): ChromeSeed => ({
  platformOs,
  windows: [
    {
      id: 1,
      focused: true,
      tabs: [{ id: 10, url: 'https://here.test/', active: true }],
    },
    {
      id: 2,
      focused: false,
      tabs: [
        { id: 20, url: 'https://other.test/', active: true },
        { id: 21, url: 'https://c.test/', groupId: 7, lastAccessed: 5 },
        { id: 22, url: 'https://b.test/', groupId: 7, lastAccessed: 9 },
      ],
    },
  ],
  tabGroups: [{ id: 7, windowId: 2, title: 'Research', color: 'red' }],
});

afterEach(() => {
  vi.restoreAllMocks();
});

const SAMPLE = 'sample:x';

async function renderSaved(
  platformOs: 'mac' | 'linux' = 'linux',
  { tour = false } = {}
) {
  const r = await renderWithProviders(
    <OpenCopiesProvider showGroups>
      <WindowEntryContainer
        number={1}
        title="Window 1"
        tabGroupId={tour ? SAMPLE : 'tg1'}
        windowId="w1"
        tabs={TABS}
        chromeTabGroups={GROUPS}
        onOpenWindow={() => undefined}
        onUpdateWindowGroupTitle={() => undefined}
        onAddCurrTabToWindowClick={() => undefined}
        onDeleteClick={() => undefined}
      />
    </OpenCopiesProvider>,
    {
      seed: seed(platformOs),
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(true));
        if (!tour) return;
        store.dispatch(
          recordFirstRun({ ...newRun('popup', 6), sessionId: SAMPLE })
        );
        store.dispatch(runShownHere());
      },
    }
  );
  await settle();
  return r;
}
type Rendered = Awaited<ReturnType<typeof renderSaved>>;

const settle = () =>
  act(() => new Promise<void>((done) => setTimeout(done, 0)));

// Polled: the live read lands after its 50ms coalesce.
const goTo = () =>
  screen.findByRole('button', { name: 'Go to group: Research' });
const openGroup = () =>
  screen.findByRole('button', { name: 'Open group: Research' });

const activeIn = async (windowId: number) =>
  (await chrome.tabs.query({ active: true, windowId }))[0]?.id;
const focusedWindow = async () => (await chrome.windows.getLastFocused()).id;

describe('the saved group’s Open', () => {
  test('says Go to group while the group is open as saved', async () => {
    await renderSaved();

    const button = await goTo();
    expect(button).toHaveAttribute('data-tooltip', 'Go to group');
    expect(
      screen.queryByRole('button', { name: 'Open group: Research' })
    ).toBeNull();
  });

  test('says Open group once a tab in the open group goes elsewhere', async () => {
    const r = await renderSaved();
    await goTo();

    act(() => r.chrome.browser.updateTab(21, { url: 'https://d.test/' }));

    const button = await openGroup();
    expect(button).toHaveAttribute('data-tooltip', 'Open group');
  });

  test('says Go to group again once the open group matches again', async () => {
    const r = await renderSaved();
    act(() => r.chrome.browser.updateTab(21, { url: 'https://d.test/' }));
    await openGroup();

    act(() => r.chrome.browser.updateTab(21, { url: 'https://c.test/' }));

    expect(await goTo()).toHaveAttribute('data-tooltip', 'Go to group');
  });
});

describe('a plain click', () => {
  test("switches to the group's last used tab and focuses its window; opens nothing", async () => {
    const r = await renderSaved();

    fireEvent.click(await goTo());

    await vi.waitFor(async () => expect(await activeIn(2)).toBe(22));
    expect(await focusedWindow()).toBe(2);
    await settle();
    expect(r.chrome.createdTabs).toEqual([]);
  });

  test('opens a copy when the group closed after the button was drawn', async () => {
    const r = await renderSaved();
    const button = await goTo();

    // Before the live read can rename the button.
    act(() => r.chrome.browser.closeTab(21));
    fireEvent.click(button);

    await vi.waitFor(() => expect(r.chrome.createdTabs).toHaveLength(2));
    expect(r.chrome.createdTabs.map((t) => t.url)).toEqual([
      'https://b.test/',
      'https://c.test/',
    ]);
    expect(await activeIn(2)).toBe(20);
  });
});

describe('a new copy in the background, even with the group open', () => {
  const expectBackgroundCopy = async (r: Rendered) => {
    await vi.waitFor(() => expect(r.chrome.createdTabs).toHaveLength(2));
    await settle();
    expect(r.chrome.createdTabs.every((t) => t.active !== true)).toBe(true);
    const groups = await chrome.tabGroups.query({ title: 'Research' });
    expect(groups.map((g) => g.windowId).sort()).toEqual([1, 2]);
    // Never switches: window 1 and its tab stay in front.
    expect(await activeIn(1)).toBe(10);
    expect(await activeIn(2)).toBe(20);
    expect(await focusedWindow()).toBe(1);
  };

  test('middle-click', async () => {
    const r = await renderSaved();

    fireEvent(
      await goTo(),
      new MouseEvent('auxclick', { bubbles: true, button: 1 })
    );

    await expectBackgroundCopy(r);
  });

  test('a middle press does not start autoscroll', async () => {
    await renderSaved();
    const press = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 1,
    });

    (await goTo()).dispatchEvent(press);

    expect(press.defaultPrevented).toBe(true);
  });

  test('a right-button auxclick opens nothing (the menu has it)', async () => {
    const r = await renderSaved();

    fireEvent(
      await goTo(),
      new MouseEvent('auxclick', { bubbles: true, button: 2 })
    );

    await settle();
    expect(r.chrome.createdTabs).toEqual([]);
  });

  test('⌘-click on a Mac', async () => {
    const r = await renderSaved('mac');

    fireEvent.click(await goTo(), { metaKey: true });

    await expectBackgroundCopy(r);
  });

  test('Ctrl-click off a Mac', async () => {
    const r = await renderSaved('linux');

    fireEvent.click(await goTo(), { ctrlKey: true });

    await expectBackgroundCopy(r);
  });
});

describe('a Ctrl-click on a Mac (KAN-708)', () => {
  test('CONTROL: is the context menu, never a switch or an open', async () => {
    const r = await renderSaved('mac');
    const button = await goTo();

    fireEvent.mouseDown(button, { button: 0, ctrlKey: true });
    fireEvent.click(button, { ctrlKey: true });

    await settle();
    expect(r.chrome.createdTabs).toEqual([]);
    expect(await activeIn(2)).toBe(20);
    expect(await focusedWindow()).toBe(1);
  });
});

describe('the menu’s Open', () => {
  test('opens a copy in front, even with the group open', async () => {
    const r = await renderSaved();
    await goTo();

    fireEvent.contextMenu(
      screen.getByRole('button', { name: 'Rename group: Research' })
    );
    const menu = document.querySelector<HTMLElement>('[data-row-menu]');
    if (!menu) throw new Error('no row menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Open' }));

    await vi.waitFor(() => expect(r.chrome.createdTabs).toHaveLength(2));
    await settle();
    // The copy's last tab comes to the front of Tab Keeper's window.
    const [front] = await chrome.tabs.query({ active: true, windowId: 1 });
    expect(front?.url).toBe('https://c.test/');
    expect(await activeIn(2)).toBe(20);
  });
});

describe('while the tour blocks opens (KAN-413)', () => {
  test('says Switch works after the tour, and switches and opens nothing', async () => {
    const r = await renderSaved('linux', { tour: true });
    const button = await goTo();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute(
      'data-tooltip',
      'Switch works after the tour'
    );

    fireEvent(button, new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    fireEvent.click(button, { ctrlKey: true });
    fireEvent.click(button);

    await settle();
    expect(r.chrome.createdTabs).toEqual([]);
    expect(await activeIn(2)).toBe(20);
    expect(await focusedWindow()).toBe(1);
  });
});

describe('in the saved session pane', () => {
  // The pane's provider reads groups only with the grant.
  test.each([
    [true, 'Go to group: Research'],
    [false, null],
  ])('with the tab groups grant %s, the name is %s', async (granted, name) => {
    await renderWithProviders(<RightPane />, {
      seed: seed(),
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(granted));
        const session = buildSession({
          isSelected: true,
          windows: [
            {
              windowId: 'w1',
              windowHeight: 1080,
              windowWidth: 1920,
              windowOffsetTop: 0,
              windowOffsetLeft: 0,
              tabCount: 3,
              title: 'Window 1',
              tabs: TABS,
              chromeTabGroups: GROUPS,
            },
          ],
        });
        store.dispatch(saveToTabContainerInternal(session));
        store.dispatch(selectTabContainer(session.tabGroupId));
      },
    });
    await settle();

    if (name === null) {
      // Without the grant the group draws no row of its own.
      expect(
        screen.queryByRole('button', { name: /group: Research$/ })
      ).toBeNull();
    } else {
      expect(await screen.findByRole('button', { name })).not.toBeNull();
    }
  });
});
