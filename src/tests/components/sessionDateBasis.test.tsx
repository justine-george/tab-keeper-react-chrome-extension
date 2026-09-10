import { describe, expect, test, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import MenuContainer from '../../components/home/leftpane/MenuContainer';
import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { RenderWithProvidersResult } from '../setup/renderWithProviders';
import {
  restoreContainer,
  saveToTabContainerInternal,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-141. Which date the rows show follows the date order the user chose, so
// the number on a row always describes the order the list is in.
//
// The preference lives in device-local settings, NOT on the container:
// saveToFirestore sends tabContainerData and nothing else, so keeping it here
// costs no merge rule -- the same reasoning that kept the sort mode derived in
// KAN-130 and KAN-136 rather than stored.

const T0 = Date.UTC(2026, 8, 9, 12, 0, 0);

const session = (id: string, at: number) => ({
  tabGroupId: id,
  title: id,
  createdTime: '2026-09-09 12:00:00',
  createdAt: at,
  windowCount: 1,
  tabCount: 1,
  isAutoSave: false,
  isSelected: false,
  windows: [
    {
      windowId: `${id}-w`,
      windowHeight: 100,
      windowWidth: 100,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: 'Window',
      tabs: [
        { tabId: `${id}-t`, favicon: '', title: 'Tab', url: 'https://a.co' },
      ],
    },
  ],
});

const render = () =>
  renderWithProviders(<MenuContainer />, {
    seedStore: (store) => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(T0);
        store.dispatch(saveToTabContainerInternal(session('a', T0)));
      } finally {
        vi.useRealTimers();
      }
    },
  });

const openMenu = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Sort sessions' }));

const item = (label: string) =>
  screen.getByRole('menuitemradio', { name: label });

const basisOf = (store: RenderWithProvidersResult['store']) =>
  store.getState().settingsDataState.sessionDateBasis;

const storedBasis = () => {
  const raw = localStorage.getItem('settingsData');
  return raw ? JSON.parse(raw).sessionDateBasis : undefined;
};

beforeEach(() => localStorage.clear());

describe('the date basis follows the chosen date order', () => {
  test('defaults to edited, which is the default order', async () => {
    const { store } = await render();

    expect(basisOf(store)).toBe('edited');
  });

  test('sorting by date saved switches the rows to created', async () => {
    const { store } = await render();

    openMenu();
    fireEvent.click(item('Date saved'));

    expect(basisOf(store)).toBe('created');
  });

  test('and returning to date modified switches them back', async () => {
    const { store } = await render();
    openMenu();
    fireEvent.click(item('Date saved'));
    expect(basisOf(store)).toBe('created');

    openMenu();
    fireEvent.click(item('Date modified'));

    expect(basisOf(store)).toBe('edited');
  });

  // KAN-144. Name and tab count take the DEFAULT basis rather than keeping
  // whatever was chosen before.
  //
  // This reverses KAN-141, which left the basis alone here on the grounds that
  // neither is a date order, so there is no date for them to be right about.
  // That argues for the default, not for keeping a stale one: it left every row
  // reading "Created" after a trip through Date saved, including sessions
  // edited since, in a list no longer in any date order at all. Justine:
  // "the created date in general for all should be shown only for the sort by
  // created date setting."
  //
  // Each starts from `created`, because starting from the default cannot tell
  // "set to edited" apart from "left alone" -- which is exactly the shape of
  // the old tab-count test, and why only one of the two ever had force.
  for (const label of ['Name', 'Tab count'] as const) {
    test(`sorting by ${label} returns the basis to edited`, async () => {
      const { store } = await render();
      openMenu();
      fireEvent.click(item('Date saved'));
      expect(basisOf(store)).toBe('created');

      openMenu();
      fireEvent.click(item(label));

      expect(basisOf(store)).toBe('edited');
    });
  }
});

// It has to survive the popup closing, or the label would drift away from the
// order on the very next open: ranks are stored, so a date-saved sort persists,
// and a basis that reset would leave created-ordered rows labelled "Edited".
describe('the basis is remembered on this device', () => {
  test('a change is written to localStorage', async () => {
    await render();

    openMenu();
    fireEvent.click(item('Date saved'));

    expect(storedBasis()).toBe('created');
  });

  // The other half: what is written has to be what is read back. A setting
  // saved under a different key, or saved and never loaded, passes the test
  // above and still resets on every open.
  //
  // RE-IMPORTED, not merely re-rendered. The settings slice reads localStorage
  // once, at module load, to build its initialState -- which is right for a
  // popup, since the module loads fresh every time it opens, but means a second
  // store inside one test process reuses the value captured on first import.
  // resetModules is what makes this test exercise the mechanism the popup
  // actually relies on rather than a cached constant.
  test('and is read back at module load, the way a popup open reads it', async () => {
    await render();
    openMenu();
    fireEvent.click(item('Date saved'));
    expect(storedBasis()).toBe('created');

    vi.resetModules();
    const reloaded = await import('../../redux/slices/settingsDataStateSlice');

    expect(reloaded.initialState.sessionDateBasis).toBe('created');
  });

  // CONTROL for the test above. Without it, an initialState that hard-coded
  // 'created' -- or a resetModules that quietly did nothing -- would pass it.
  test('CONTROL: an untouched device loads the edited default', async () => {
    localStorage.clear();

    vi.resetModules();
    const reloaded = await import('../../redux/slices/settingsDataStateSlice');

    expect(reloaded.initialState.sessionDateBasis).toBe('edited');
  });
});

// KAN-144, asserted where the user actually sees it. The store-level tests
// above pin the basis; this pins that the basis reaches the row, and that the
// never-edited fallback is not collateral damage of changing it.
describe('the word on the row after a non-date sort', () => {
  // A session with no contentModified at all -- the state legacy data is in,
  // since every reducer that writes content has stamped it since KAN-141. It
  // cannot be produced by saving, which stamps it, so the container is handed
  // over whole the way a merge or an undo hands one over.
  const renderRows = () =>
    renderWithProviders(
      <>
        <MenuContainer />
        <TabGroupEntryContainer />
      </>,
      {
        seedStore: (store) => {
          const edited = { ...session('edited-one', T0), contentModified: T0 };
          const untouched = session('never-edited', T0 - 3600_000);
          delete (untouched as { contentModified?: number }).contentModified;
          store.dispatch(
            restoreContainer({
              lastModified: T0,
              selectedTabGroupId: 'edited-one',
              tabGroups: [edited, untouched],
              deletedTabGroups: [],
            })
          );
        },
      }
    );

  // The label's own element, found by its whole text rather than by searching
  // the row's. A row's textContent runs its parts together -- "...1 TabCreated
  // Sep 9..." -- so there is no word boundary in front of the word and a
  // /\bCreated\b/ over the row matches nothing at all. Anchoring at ^ on each
  // descendant also keeps a session TITLED "Edited something" from answering
  // for the date.
  const wordOn = (id: string) => {
    const row = document.querySelector<HTMLElement>(
      `[data-drag-row-id="${id}"]`
    );
    const label = [...(row?.querySelectorAll<HTMLElement>('div') ?? [])]
      .map((el) => el.textContent ?? '')
      .find((text) => /^(Edited|Created) /.test(text));
    return label?.split(' ')[0];
  };

  test('an edited session reads Edited once the sort is by name', async () => {
    await renderRows();
    // The premise: Date saved really does put it in the state being fixed.
    openMenu();
    fireEvent.click(item('Date saved'));
    expect(wordOn('edited-one')).toBe('Created');

    openMenu();
    fireEvent.click(item('Name'));

    expect(wordOn('edited-one')).toBe('Edited');
  });

  // THE CONTROL. "Edited" is a false statement about a session that never was,
  // so this row must keep saying Created through the same sort -- otherwise the
  // fix would be indistinguishable from hard-coding the word.
  test('CONTROL: a never-edited session still reads Created', async () => {
    await renderRows();
    openMenu();
    fireEvent.click(item('Name'));

    expect(wordOn('never-edited')).toBe('Created');
    expect(wordOn('edited-one')).toBe('Edited');
  });
});
