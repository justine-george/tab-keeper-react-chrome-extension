import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';

import MainContainer from '../../components/MainContainer';
import { OPEN_NOW_RAIL_QUERY } from '../../components/home/opennow/railQuery';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';
import { openNowTrack } from '../setup/openNowTrack';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setFoldSavedSessionInTabView } from '../../redux/slices/settingsDataStateSlice';
import { buildSession } from '../fixtures/sessionFixture';

// KAN-808. In the full view, the saved session's title line carries a
// button where the rename pencil was: it folds Open now to its 44px rail so
// the saved session takes the width, and shows it again. One fold at a
// time. The popup (no Open now) and a narrow window (already the rail) keep
// the pencil.

const FOLD_OPEN_NOW = 'Fold the Currently open panel away';
const SHOW_OPEN_NOW = 'Show the Currently open panel';
const FOLD_SAVED = 'Fold the saved session away';
const PENCIL = 'Rename session';
const RAIL_NAME = 'Currently open, 3 Tabs';
const GRIP = 'Resize the Currently open panel';
// Only the pane renders this line, so its presence is the pane's.
const PANE_ONLY = 'Updates as you browse';
// Only HeroContainerRight renders this, so its presence is the saved detail's.
const HERO_ONLY = 'Open session, keeping current windows';
const ORIGINAL_INNER_WIDTH = window.innerWidth;

const twoWindows = (): ChromeSeed => ({
  windows: [
    {
      id: 1,
      focused: true,
      tabs: [{ title: 'A', url: 'https://a.test/', active: true }],
    },
    {
      id: 2,
      focused: false,
      tabs: [
        { title: 'B', url: 'https://b.test/', active: false },
        { title: 'C', url: 'https://c.test/', active: true },
      ],
    },
  ],
});

let railQuery: FakeMediaQueryList;
function installMatchMedia(narrow: boolean) {
  railQuery = new FakeMediaQueryList(OPEN_NOW_RAIL_QUERY, narrow);
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) =>
    query === OPEN_NOW_RAIL_QUERY
      ? railQuery
      : new FakeMediaQueryList(query, false)
  );
}

const setViewportWidth = (width: number) => {
  act(() => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: width,
    });
    window.dispatchEvent(new Event('resize'));
  });
};

const renderHome = (title = 'First session') =>
  renderWithProviders(<MainContainer />, {
    seed: twoWindows(),
    seedStore: (store) => {
      store.dispatch(
        saveToTabContainerInternal(buildSession({ tabGroupId: 'first', title }))
      );
      store.dispatch(selectTabContainer('first'));
      store.dispatch(setFoldSavedSessionInTabView(false));
    },
  });

const mounted = () => screen.findByRole('button', { name: 'Sort sessions' });
const button = (name: string) => screen.queryByRole('button', { name });
const detail = () => {
  const pane = document.querySelector<HTMLElement>('[data-pane="detail"]');
  if (pane === null) throw new Error('no detail pane');
  return pane;
};
const openNowSlot = () => {
  const slot = document.querySelector<HTMLElement>('[data-pane="open-now"]');
  if (slot === null) throw new Error('no Open now slot');
  return slot;
};
const folds = (store: {
  getState: () => {
    settingsDataState: {
      foldSavedSessionInTabView: boolean;
      foldOpenNowInTabView: boolean;
    };
  };
}) => {
  const s = store.getState().settingsDataState;
  return {
    saved: s.foldSavedSessionInTabView,
    openNow: s.foldOpenNowInTabView,
  };
};

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '?view=tab');
  installMatchMedia(false);
});

afterEach(() => {
  history.replaceState(null, '', '/');
  localStorage.clear();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: ORIGINAL_INNER_WIDTH,
  });
});

describe('where the button shows', () => {
  test('the full view: on the title line, always shown, in place of the pencil', async () => {
    await renderHome();
    await mounted();
    const fold = within(detail()).getByRole('button', { name: FOLD_OPEN_NOW });
    expect(fold).toBeInTheDocument();
    expect(within(detail()).queryByRole('button', { name: PENCIL })).toBeNull();
    // Shown at rest: the slot is not the pencil's hover reveal.
    expect(getComputedStyle(fold.parentElement!).opacity).toBe('1');
  });

  test('the popup: no Open now to fold, so the pencil stays', async () => {
    history.replaceState(null, '', '/');
    await renderHome();
    await mounted();
    expect(button(PENCIL)).toBeInTheDocument();
    expect(button(FOLD_OPEN_NOW)).toBeNull();
  });

  test('narrow: Open now is already the rail, so the pencil stays', async () => {
    installMatchMedia(true);
    await renderHome();
    await mounted();
    expect(
      within(detail()).getByRole('button', { name: PENCIL })
    ).toBeInTheDocument();
    expect(button(FOLD_OPEN_NOW)).toBeNull();
  });

  test('renaming: the save tick takes the slot for the whole edit', async () => {
    await renderHome();
    await mounted();
    fireEvent.click(
      within(detail()).getByRole('button', {
        name: 'Rename session: First session',
      })
    );
    expect(
      within(detail()).getByRole('button', { name: 'Save changes' })
    ).toBeInTheDocument();
    expect(button(FOLD_OPEN_NOW)).toBeNull();
  });
});

describe('the press', () => {
  test('folds Open now to its 44px rail, and the next press shows it again', async () => {
    const { store } = await renderHome();
    await mounted();
    expect(within(openNowSlot()).getByText(PANE_ONLY)).toBeInTheDocument();

    const fold = button(FOLD_OPEN_NOW)!;
    fold.focus();
    fireEvent.click(fold);
    expect(folds(store)).toEqual({ saved: false, openNow: true });
    expect(
      await screen.findByRole('button', { name: RAIL_NAME })
    ).toBeInTheDocument();
    expect(within(openNowSlot()).queryByText(PANE_ONLY)).toBeNull();
    expect(openNowTrack()).toBe('44px');
    // The saved session stays, and the button now says what it will do.
    expect(screen.getByRole('button', { name: HERO_ONLY })).toBeInTheDocument();
    const show = within(detail()).getByRole('button', { name: SHOW_OPEN_NOW });
    // The same button, so focus stays on it.
    expect(show).toBe(fold);
    expect(show).toHaveFocus();

    fireEvent.click(show);
    expect(folds(store)).toEqual({ saved: false, openNow: false });
    expect(within(openNowSlot()).getByText(PANE_ONLY)).toBeInTheDocument();
    expect(openNowTrack()).not.toBe('44px');
  });

  test('is remembered on this device', async () => {
    await renderHome();
    await mounted();
    fireEvent.click(button(FOLD_OPEN_NOW)!);
    expect(JSON.parse(localStorage.getItem('settingsData')!)).toMatchObject({
      foldOpenNowInTabView: true,
      foldSavedSessionInTabView: false,
    });
  });

  test("Open now's resize grip goes with the pane", async () => {
    setViewportWidth(1600);
    await renderHome();
    await mounted();
    expect(screen.getByRole('separator', { name: GRIP })).toBeInTheDocument();
    fireEvent.click(button(FOLD_OPEN_NOW)!);
    expect(screen.queryByRole('separator', { name: GRIP })).toBeNull();
  });
});

describe('folded to the rail', () => {
  test("the rail's button opens the drawer, and Open now stays folded", async () => {
    const { store } = await renderHome();
    await mounted();
    fireEvent.click(button(FOLD_OPEN_NOW)!);
    const rail = await screen.findByRole('button', { name: RAIL_NAME });
    fireEvent.click(rail);
    expect(rail).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(PANE_ONLY)).toBeInTheDocument();
    expect(folds(store)).toEqual({ saved: false, openNow: true });
  });

  test('folding the saved session from the drawer shows Open now in its column', async () => {
    const { store } = await renderHome();
    await mounted();
    fireEvent.click(button(FOLD_OPEN_NOW)!);
    fireEvent.click(await screen.findByRole('button', { name: RAIL_NAME }));
    fireEvent.click(screen.getByRole('button', { name: FOLD_SAVED }));
    expect(folds(store)).toEqual({ saved: true, openNow: false });
    expect(screen.queryByRole('button', { name: HERO_ONLY })).toBeNull();
    expect(screen.getByText(PANE_ONLY)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: RAIL_NAME })).toBeNull();
    // The pressed button went with the drawer: focus goes to Open now's heading.
    expect(
      screen.getByRole('heading', { name: 'Currently open' })
    ).toHaveFocus();
  });
});

describe('a peek', () => {
  test('folding Open now while a peek shows the saved session keeps it shown, and ends the peek', async () => {
    const { store } = await renderHome();
    await mounted();
    act(() => {
      store.dispatch(setFoldSavedSessionInTabView(true));
    });
    // A click on the saved session's row peeks at it.
    const sessions = document.querySelector<HTMLElement>(
      '[data-pane="sessions"]'
    )!;
    fireEvent.click(
      within(sessions).getByRole('button', { name: 'First session' })
    );
    expect(store.getState().globalState.isPeekingSavedSession).toBe(true);

    fireEvent.click(await screen.findByRole('button', { name: FOLD_OPEN_NOW }));
    expect(folds(store)).toEqual({ saved: false, openNow: true });
    expect(store.getState().globalState.isPeekingSavedSession).toBe(false);
    expect(screen.getByRole('button', { name: HERO_ONLY })).toBeInTheDocument();
  });
});
