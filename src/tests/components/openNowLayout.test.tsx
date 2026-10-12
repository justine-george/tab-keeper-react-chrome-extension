import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';

import MainContainer from '../../components/MainContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { buildSession } from '../fixtures/sessionFixture';
import { applyOtherPageSettings } from '../../redux/otherPageChanges';
import {
  hydrateSettingsFromOtherPage,
  setTheme,
  Theme,
} from '../../redux/slices/settingsDataStateSlice';

// KAN-280 O1/O3/O4/O5. The tab view puts Open now in its reserved third
// column (layout A). One button folds the saved session away, so Open now
// takes the detail column; the first open is folded; only the button's choice
// is remembered (foldSavedSessionInTabView, device-local settingsData); and
// clicking a saved session while folded shows it for now (a peek) without
// touching that choice.

// Only HeroContainerRight renders this, and it renders in the tab view (D7
// keeps Open session there), so its presence is the saved detail's.
const HERO_ONLY = 'Open session, keeping current windows';
const FOLD = 'Fold the saved session away';
const UNFOLD = 'Show the saved session';

// Factories: the save reducer's result is frozen by Immer, so a session
// object handed to two stores would throw on the second.
const first = () =>
  buildSession({ tabGroupId: 'first', title: 'First session' });
const second = () =>
  buildSession({ tabGroupId: 'second', title: 'Second session' });
const FIRST = { tabGroupId: 'first', title: 'First session' };
const SECOND = { tabGroupId: 'second', title: 'Second session' };

const goToTabView = () => history.replaceState(null, '', '?view=tab');

// The fold setting as stored, or undefined when absent.
function storedFold(): unknown {
  const raw = localStorage.getItem('settingsData');
  if (raw === null) return undefined;
  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === 'object' &&
    parsed !== null &&
    'foldSavedSessionInTabView' in parsed
    ? parsed.foldSavedSessionInTabView
    : undefined;
}

// Two sessions, FIRST selected. saveToTabContainerInternal puts each new one
// on top, so SECOND is saved first to leave FIRST on top.
const renderHome = () =>
  renderWithProviders(<MainContainer />, {
    seedStore: (store) => {
      store.dispatch(saveToTabContainerInternal(second()));
      store.dispatch(saveToTabContainerInternal(first()));
      store.dispatch(selectTabContainer(FIRST.tabGroupId));
    },
  });

const openNowPane = () =>
  document.querySelector<HTMLElement>('[data-pane="open-now"]');

const sessionRow = (title: string) => {
  const sessions = document.querySelector<HTMLElement>(
    '[data-pane="sessions"]'
  );
  if (sessions === null) throw new Error('no sessions pane');
  return within(sessions).getByRole('button', { name: title });
};

// Waits for the app to mount before any negative query is trusted. The
// header's sort control renders in the popup and the tab view alike.
const mounted = () => screen.findByRole('button', { name: 'Sort sessions' });

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  history.replaceState(null, '', '/');
  localStorage.clear();
});

describe('the tab view opens folded (O5, Review Focus 6)', () => {
  // An existing user has settingsData saved without the new field. The slice
  // reads localStorage once, at module load, so it is re-imported to read it
  // the way a page open does.
  test('an existing user with settings saved before the field existed opens folded', async () => {
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ theme: 'Light', cloudConsent: 'granted' })
    );

    vi.resetModules();
    const reloaded = await import('../../redux/slices/settingsDataStateSlice');

    expect(reloaded.initialState.foldSavedSessionInTabView).toBe(true);
  });
});

describe('the fold button (O4, O5)', () => {
  // KAN-279 D9. Every settings write saves the whole object, so a page that
  // kept a stale fold would put it back with its next unrelated write (a
  // theme change in the popup, say). The other page's write must be taken in.
  test("another page's fold choice survives this page's next settings write", async () => {
    const { store } = await renderHome();
    await mounted();
    // The tab view pressed Show the saved session.
    localStorage.setItem(
      'settingsData',
      JSON.stringify({
        ...store.getState().settingsDataState,
        foldSavedSessionInTabView: false,
      })
    );

    store.dispatch(applyOtherPageSettings());
    store.dispatch(setTheme(Theme.BLUE));

    expect(storedFold()).toBe(false);
  });
});

describe('the peek (O5)', () => {
  // The selected row is highlighted in the list, so clicking it is the
  // natural way to ask to see it. The row's own handler returns early for
  // the selected session; the peek must not.
  test('clicking the already-selected session while folded also shows it', async () => {
    goToTabView();
    await renderHome();
    await mounted();

    fireEvent.click(sessionRow(FIRST.title));

    expect(
      await screen.findByRole('button', { name: HERO_ONLY })
    ).toBeInTheDocument();
  });

  test('Fold the saved session away while peeking folds', async () => {
    goToTabView();
    await renderHome();
    await mounted();
    fireEvent.click(sessionRow(SECOND.title));
    // PREMISE: peeking, so the button offers to fold.
    await screen.findByRole('button', { name: HERO_ONLY });

    fireEvent.click(screen.getByRole('button', { name: FOLD }));

    expect(
      screen.queryByRole('button', { name: HERO_ONLY })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: UNFOLD })).toBeInTheDocument();
    expect(storedFold()).toBe(true);
  });

  // A click while side by side is not a peek: nothing is folded away to
  // show. Were it one, the flag would outlive the click and hold this page
  // open through a later fold -- here, another page's, arriving as a
  // settings hydrate (KAN-279 D9).
  test('a click while side by side does not stop a later fold from another page', async () => {
    goToTabView();
    const { store } = await renderHome();
    await mounted();
    fireEvent.click(screen.getByRole('button', { name: UNFOLD }));
    await screen.findByRole('button', { name: HERO_ONLY });
    fireEvent.click(sessionRow(SECOND.title));
    // PREMISE: still side by side after the click.
    expect(
      await screen.findByRole('button', { name: HERO_ONLY })
    ).toBeInTheDocument();

    act(() => {
      store.dispatch(
        hydrateSettingsFromOtherPage({
          ...store.getState().settingsDataState,
          foldSavedSessionInTabView: true,
        })
      );
    });

    expect(
      screen.queryByRole('button', { name: HERO_ONLY })
    ).not.toBeInTheDocument();
    expect(document.querySelector('[data-pane="detail"]')).toBeNull();
    expect(openNowPane()).not.toBeNull();
    expect(screen.getByRole('button', { name: UNFOLD })).toBeInTheDocument();
  });
});

// KAN-385 S2: the search row replaces the caption at the top of the list.
describe('the saved search row heads the session list (S2)', () => {
  test('CONTROL: clicking a session in the popup never writes a fold setting', async () => {
    await renderHome();
    await mounted();

    fireEvent.click(sessionRow(SECOND.title));

    expect(
      await screen.findByRole('button', { name: HERO_ONLY })
    ).toBeInTheDocument();
    expect(storedFold()).toBeUndefined();
  });
});

// O3a, kept by S2 for the search row: it sits above the element that scrolls
// the session list, inside the list box's border, so that scroller holds
// session rows and nothing else. The drag engine measures the scroller as all
// rows and auto-scrolls from its edges; a sticky row laid over the top rows
// would put hidden rows under the pointer.
describe('the saved search row stays put while the list scrolls (O3a)', () => {
  // The element the drag engine takes for the list's scroller: the nearest
  // ancestor of a row that scrolls (RowDragArea's paneOf). jsdom does not
  // expand the `overflow` shorthand into overflowY (measured: overflow 'auto',
  // overflowY 'visible'), so both are read.
  const scrolls = (value: string) => value === 'auto' || value === 'scroll';
  function listScroller(): HTMLElement {
    const firstRow = document.querySelector<HTMLElement>(
      '[data-pane="sessions"] [data-drag-row-id]'
    );
    let el = firstRow?.parentElement ?? null;
    while (el && el !== document.body) {
      const style = getComputedStyle(el);
      if (scrolls(style.overflowY) || scrolls(style.overflow)) return el;
      el = el.parentElement;
    }
    throw new Error('no scroll container above the session rows');
  }

  const searchRow = () =>
    document.querySelector<HTMLElement>('[data-saved-search]');

  // The popup's list takes the same shape (S2).
  test('in the popup too the row sits directly above the scroller, which starts with the rows', async () => {
    await renderHome();
    await mounted();

    const row = searchRow();
    if (row === null) throw new Error('no search row');
    const scroller = listScroller();
    expect(scroller.contains(row)).toBe(false);
    expect(row.nextElementSibling).toBe(scroller);
    const firstRow = document.querySelector('[data-drag-row-id]');
    expect(scroller.firstElementChild?.contains(firstRow)).toBe(true);
  });
});
