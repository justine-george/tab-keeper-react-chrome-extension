import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';

import MainContainer from '../../components/MainContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { buildSession } from '../fixtures/sessionFixture';
import { applyOtherPageSettings } from '../../redux/otherPageChanges';
import { setTheme, Theme } from '../../redux/slices/settingsDataStateSlice';

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
  test('with no fold setting stored, Open now shows and the saved detail does not', async () => {
    goToTabView();
    await renderHome();
    await mounted();

    expect(storedFold()).toBeUndefined();
    expect(openNowPane()).not.toBeNull();
    expect(screen.getByRole('button', { name: UNFOLD })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: HERO_ONLY })
    ).not.toBeInTheDocument();
    expect(document.querySelector('[data-pane="detail"]')).toBeNull();
  });

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
  test('Show the saved session puts the detail beside Open now and remembers false', async () => {
    goToTabView();
    await renderHome();
    await mounted();

    fireEvent.click(screen.getByRole('button', { name: UNFOLD }));

    expect(
      await screen.findByRole('button', { name: HERO_ONLY })
    ).toBeInTheDocument();
    expect(openNowPane()).not.toBeNull();
    expect(screen.getByRole('button', { name: FOLD })).toBeInTheDocument();
    expect(storedFold()).toBe(false);
  });

  test('Fold the saved session away folds from side by side and remembers true', async () => {
    goToTabView();
    await renderHome();
    await mounted();
    fireEvent.click(screen.getByRole('button', { name: UNFOLD }));
    await screen.findByRole('button', { name: HERO_ONLY });
    // PREMISE: side by side, remembered as such.
    expect(storedFold()).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: FOLD }));

    expect(
      screen.queryByRole('button', { name: HERO_ONLY })
    ).not.toBeInTheDocument();
    expect(openNowPane()).not.toBeNull();
    expect(storedFold()).toBe(true);
  });

  // Folding moves Open now between grid areas, not between parents, so the
  // pane is not remounted: no second read of the windows, and a window the
  // user folded inside it stays folded.
  test('folding and unfolding keeps the same Open now, with no re-read', async () => {
    goToTabView();
    const { chrome } = await renderHome();
    await mounted();
    await screen.findByText('No other tabs are open');
    const reads = chrome.windowsGetAllCalls;
    // PREMISE: the pane has read once.
    expect(reads).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: UNFOLD }));
    await screen.findByRole('button', { name: HERO_ONLY });
    fireEvent.click(screen.getByRole('button', { name: FOLD }));

    expect(chrome.windowsGetAllCalls).toBe(reads);
  });

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
  test('clicking a saved session while folded shows it, and the setting stays true', async () => {
    goToTabView();
    await renderHome();
    await mounted();
    fireEvent.click(screen.getByRole('button', { name: UNFOLD }));
    fireEvent.click(await screen.findByRole('button', { name: FOLD }));
    // PREMISE: folded, and the setting is stored as true.
    expect(storedFold()).toBe(true);
    expect(
      screen.queryByRole('button', { name: HERO_ONLY })
    ).not.toBeInTheDocument();

    fireEvent.click(sessionRow(SECOND.title));

    expect(
      await screen.findByRole('button', { name: HERO_ONLY })
    ).toBeInTheDocument();
    expect(openNowPane()).not.toBeNull();
    expect(storedFold()).toBe(true);
  });

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

  // A new page is a fresh store: the peek (globalState) is gone, and the
  // setting is read back from localStorage at module load. Everything is
  // re-imported so the new page reads storage the way a real open does.
  test('a new page after a peek opens folded again', async () => {
    goToTabView();
    await renderHome();
    await mounted();
    fireEvent.click(sessionRow(SECOND.title));
    await screen.findByRole('button', { name: HERO_ONLY });
    // PREMISE: the peek wrote nothing, so storage holds no fold at all and
    // the next page falls back to the default.
    expect(storedFold()).toBeUndefined();
    cleanup();

    vi.resetModules();
    const fresh = await import('../setup/renderWithProviders');
    const { default: FreshMainContainer } = await import(
      '../../components/MainContainer'
    );
    const tabSlice = await import(
      '../../redux/slices/tabContainerDataStateSlice'
    );
    await fresh.renderWithProviders(<FreshMainContainer />, {
      seedStore: (store) => {
        store.dispatch(tabSlice.saveToTabContainerInternal(first()));
        store.dispatch(tabSlice.selectTabContainer(FIRST.tabGroupId));
      },
    });
    await mounted();

    expect(openNowPane()).not.toBeNull();
    expect(
      screen.queryByRole('button', { name: HERO_ONLY })
    ).not.toBeInTheDocument();
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
});

describe('the Saved sessions caption (O3)', () => {
  test('is at the top of the session list in the tab view', async () => {
    goToTabView();
    await renderHome();
    await mounted();

    const sessions = document.querySelector<HTMLElement>(
      '[data-pane="sessions"]'
    );
    if (sessions === null) throw new Error('no sessions pane');
    const caption = within(sessions).getByText('Saved sessions');
    // At the top of the list box: before its first row.
    const firstRow = sessions.querySelector('[data-drag-row-id]');
    if (firstRow === null) throw new Error('no session row');
    expect(
      caption.compareDocumentPosition(firstRow) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  // CONTROL. The popup is unchanged: no caption, and no Open now.
  test('CONTROL: the popup has no caption and no Open now', async () => {
    await renderHome();
    await mounted();

    expect(screen.queryByText('Saved sessions')).not.toBeInTheDocument();
    expect(openNowPane()).toBeNull();
    // The popup still shows the detail as it always has.
    expect(screen.getByRole('button', { name: HERO_ONLY })).toBeInTheDocument();
  });

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
