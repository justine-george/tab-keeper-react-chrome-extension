import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { useSelector } from 'react-redux';

import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import { tabCarryOut } from '../../components/home/rightpane/carryOut';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  replaceState,
  type tabData,
  type TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  runShownHere,
  setSearchInputText,
} from '../../redux/slices/globalStateSlice';
import { recordFirstRun } from '../../redux/slices/settingsDataStateSlice';
import { newRun } from '../../utils/functions/firstRun';

// KAN-824. Rename tab in a saved tab's right-click menu.

const PAGE = 'Alex Jo on X: "Sync is hard" / X';
const TABS: tabData[] = [
  { tabId: 't1', favicon: '', title: PAGE, url: 'https://x.com/alexjo/1' },
  {
    tabId: 't2',
    favicon: '',
    title: 'Kagi',
    url: 'https://kagi.com/',
    customTitle: 'Search',
  },
  { tabId: 't3', favicon: '', title: 'Docs', url: 'https://docs.test/' },
];

type State = { tabContainerDataState: TabMasterContainer };

// The pane hands the row its tabs from the store; so does this, so a rename shows.
function Saved({ tabGroupId }: { tabGroupId: string }) {
  const tabs = useSelector(
    (s: State) =>
      s.tabContainerDataState.tabGroups.find((g) => g.tabGroupId === tabGroupId)
        ?.windows[0].tabs ?? []
  );
  return (
    <WindowEntryContainer
      number={1}
      title="Window 1"
      tabGroupId={tabGroupId}
      windowId="w1"
      tabs={tabs}
      onOpenWindow={() => undefined}
      onUpdateWindowGroupTitle={() => undefined}
      onAddCurrTabToWindowClick={() => undefined}
      onDeleteClick={() => undefined}
    />
  );
}

async function renderSaved(tabGroupId = 'tg1', tabs = TABS) {
  return renderWithProviders(<Saved tabGroupId={tabGroupId} />, {
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
                  tabCount: tabs.length,
                  title: 'Window 1',
                  tabs,
                },
              ],
            }),
          ])
        )
      );
    },
  });
}

type Store = Awaited<ReturnType<typeof renderSaved>>['store'];
const storedTab = (store: Store, tabId: string) =>
  store
    .getState()
    .tabContainerDataState.tabGroups[0].windows[0].tabs.find(
      (t) => t.tabId === tabId
    );

const row = (name: string) =>
  screen.getByRole('button', { name: `Open in new tab: ${name}` });
const menu = () => document.querySelector<HTMLElement>('[data-row-menu]')!;
const labels = () =>
  within(menu())
    .getAllByRole('menuitem')
    .map((item) => {
      // The glyph's ligature text is aria-hidden; the label is what is left.
      const copy = item.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('[aria-hidden]').forEach((n) => n.remove());
      return copy.textContent;
    });

const startRename = (name: string) => {
  fireEvent.contextMenu(row(name));
  fireEvent.click(
    within(menu()).getByRole('menuitem', { name: /^Rename tab/ })
  );
  return screen.getByRole('textbox', { name: `Rename tab: ${name}` });
};

afterEach(() => {
  fireEvent.keyDown(document.body, { key: 'a' });
  vi.restoreAllMocks();
});

describe('the saved tab menu offers Rename tab (KAN-824)', () => {
  test('after Open in new tab: open, rename, copy, delete', async () => {
    await renderSaved();
    fireEvent.contextMenu(row(PAGE));
    expect(labels()).toEqual([
      'Open in new tab',
      'Rename tab',
      'Copy link',
      'Delete tab',
    ]);
  });

  test('first when the tour blocks Open', async () => {
    const { store } = await renderSaved('sample:x');
    fireEvent.contextMenu(row(PAGE));
    act(() => {
      store.dispatch(
        recordFirstRun({ ...newRun('popup', 6), sessionId: 'sample:x' })
      );
      store.dispatch(runShownHere());
    });
    expect(labels()).toEqual(['Rename tab', 'Copy link', 'Delete tab']);
  });

  test('not while searching', async () => {
    const { store } = await renderSaved();
    act(() => {
      store.dispatch(setSearchInputText('Alex'));
    });
    fireEvent.contextMenu(row(PAGE));
    expect(labels()).toEqual(['Open in new tab', 'Copy link', 'Delete tab']);
  });
});

describe('the rename field (KAN-824)', () => {
  test('opens holding the shown name, all of it selected', async () => {
    await renderSaved();
    const field = startRename('Search') as HTMLInputElement;
    expect(field.value).toBe('Search');
    expect(field).toHaveFocus();
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe('Search'.length);
  });

  test('the tick replaces Delete while the field is open', async () => {
    await renderSaved();
    const field = startRename(PAGE);
    const tabRow = field.closest('[data-drag-handle-row]') as HTMLElement;
    expect(
      within(tabRow).queryByRole('button', { name: 'Delete tab' })
    ).toBeNull();
    expect(
      within(tabRow).getByRole('button', { name: 'Save changes' })
    ).toBeInTheDocument();
    // The favicon stays beside the field.
    expect(tabRow.querySelector('img, [data-favicon], span')).not.toBeNull();
  });

  test('Enter saves the name and gives focus back to the row', async () => {
    const { store } = await renderSaved();
    const field = startRename(PAGE);
    fireEvent.change(field, { target: { value: 'Sync notes' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(storedTab(store, 't1')?.customTitle).toBe('Sync notes');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(row('Sync notes')).toHaveFocus();
  });

  test('the tick saves', async () => {
    const { store } = await renderSaved();
    const field = startRename(PAGE);
    fireEvent.change(field, { target: { value: 'Sync notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(storedTab(store, 't1')?.customTitle).toBe('Sync notes');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  test('a click away saves', async () => {
    const { store } = await renderSaved();
    const field = startRename(PAGE);
    fireEvent.change(field, { target: { value: 'Sync notes' } });
    fireEvent.blur(field);
    expect(storedTab(store, 't1')?.customTitle).toBe('Sync notes');
  });

  test('Esc keeps the old name and closes the field', async () => {
    const { store } = await renderSaved();
    const before = store.getState().tabContainerDataState;
    const field = startRename('Search');
    fireEvent.change(field, { target: { value: 'Other' } });
    fireEvent.keyDown(field, { key: 'Escape' });

    expect(store.getState().tabContainerDataState).toBe(before);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(row('Search')).toHaveFocus();
  });

  // D13: a blur can reach the field after Esc and before it unmounts.
  test('a blur straight after Esc saves nothing', async () => {
    const { store } = await renderSaved();
    const before = store.getState().tabContainerDataState;
    const field = startRename('Search');
    fireEvent.change(field, { target: { value: 'Other' } });
    act(() => {
      field.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
      field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(store.getState().tabContainerDataState).toBe(before);
  });

  test('opening and closing it unchanged writes nothing', async () => {
    const { store } = await renderSaved();
    const before = store.getState().tabContainerDataState;
    fireEvent.keyDown(startRename('Search'), { key: 'Enter' });
    fireEvent.keyDown(startRename(PAGE), { key: 'Enter' });
    expect(store.getState().tabContainerDataState).toBe(before);
  });

  test('an empty field shows the page title and saves back to it', async () => {
    const { store } = await renderSaved();
    const field = startRename('Search');
    fireEvent.change(field, { target: { value: '' } });
    expect(field).toHaveAttribute('placeholder', 'Kagi');
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(storedTab(store, 't2')).not.toHaveProperty('customTitle');
    expect(row('Kagi')).toBeInTheDocument();
  });

  test('renaming another tab first saves the one being renamed', async () => {
    const { store } = await renderSaved();
    const field = startRename(PAGE);
    fireEvent.change(field, { target: { value: 'Sync notes' } });

    const next = startRename('Docs');

    expect(storedTab(store, 't1')?.customTitle).toBe('Sync notes');
    expect(next).toHaveValue('Docs');
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });
});

describe('a renamed tab shows its own name (KAN-824)', () => {
  test('in the row and its accessible name', async () => {
    await renderSaved();
    expect(row('Search')).toHaveTextContent('Search');
    expect(screen.queryByText('Kagi')).toBeNull();
  });

  test('in the menu name', async () => {
    await renderSaved();
    fireEvent.contextMenu(row('Search'));
    expect(menu()).toHaveAccessibleName('Search');
  });

  test("in its split partner's description", async () => {
    await renderSaved('tg1', [
      { ...TABS[1], splitId: 's' },
      { ...TABS[2], splitId: 's' },
    ]);
    expect(row('Docs')).toHaveAccessibleDescription(
      'In a split view with “Search”'
    );
  });

  test('on the drag card', () => {
    const out = tabCarryOut(
      { tabGroupId: 'tg1', windows: [{ windowId: 'w1', tabs: TABS }] },
      't2'
    );
    expect(out?.card).toMatchObject({ kind: 'tab', title: 'Search' });
  });
});

// KAN-824 (his 1A). Hovering a saved tab shows where it goes.
describe("a saved tab's tooltip (KAN-824)", () => {
  const tip = (name: string) => row(name).getAttribute('data-tooltip');

  test('is its address', async () => {
    await renderSaved();
    expect(tip(PAGE)).toBe('https://x.com/alexjo/1');
  });

  test('of a renamed tab is its page title, then its address', async () => {
    await renderSaved();
    expect(tip('Search')).toBe('Kagi\nhttps://kagi.com/');
  });

  test('of a renamed tab with no page title is just its address', async () => {
    await renderSaved('tg1', [{ ...TABS[1], title: '' }]);
    expect(tip('Search')).toBe('https://kagi.com/');
  });

  test('of a suspended tab is the address it stands for', async () => {
    await renderSaved('tg1', [
      {
        ...TABS[2],
        url: 'chrome-extension://laameccjpleogmfhilmffpdbiibgbekf/suspended.html?title=Docs&url=https%3A%2F%2Fdocs.test%2Fa',
      },
    ]);
    expect(tip('Docs')).toBe('https://docs.test/a');
  });

  test('says Open works after the tour while the tour blocks it', async () => {
    const { store } = await renderSaved('sample:x');
    act(() => {
      store.dispatch(
        recordFirstRun({ ...newRun('popup', 6), sessionId: 'sample:x' })
      );
      store.dispatch(runShownHere());
    });
    expect(tip(PAGE)).toBe('Open works after the tour');
  });
});
