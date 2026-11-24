import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';

import MainContainer from '../../components/MainContainer';
import { OPEN_NOW_RAIL_QUERY } from '../../components/home/opennow/railQuery';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setFoldSavedSessionInTabView } from '../../redux/slices/settingsDataStateSlice';
import { buildSession } from '../fixtures/sessionFixture';

// KAN-999. Folded, the saved session keeps a card between the list and
// Currently open: one button, "Saved session" under a folder glyph, that
// shows the saved session. No sessions, no card.

const SHOW = 'Show the saved session';
const FOLD = 'Fold the saved session away';
// Only HeroContainerRight renders this, so its presence is the saved detail's.
const HERO_ONLY = 'Open session, keeping current windows';

const oneWindow = (): ChromeSeed => ({
  windows: [
    {
      id: 1,
      focused: true,
      tabs: [{ title: 'A', url: 'https://a.test/', active: true }],
    },
  ],
});

function installMatchMedia(narrow: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      new FakeMediaQueryList(query, query === OPEN_NOW_RAIL_QUERY && narrow)
  );
}

const renderHome = (fold: boolean, withSession = true) =>
  renderWithProviders(<MainContainer />, {
    seed: oneWindow(),
    seedStore: (store) => {
      if (withSession) {
        store.dispatch(
          saveToTabContainerInternal(
            buildSession({ tabGroupId: 'first', title: 'First session' })
          )
        );
        store.dispatch(selectTabContainer('first'));
      }
      store.dispatch(setFoldSavedSessionInTabView(fold));
    },
  });

const card = () =>
  document.querySelector<HTMLElement>('[data-saved-session-card]');
const openNowSlot = () => {
  const slot = document.querySelector<HTMLElement>('[data-pane="open-now"]');
  if (slot === null) throw new Error('no Open now slot');
  return slot;
};
// The tab view's second track: the card's.
const cardTrack = () => {
  const grid = openNowSlot().parentElement;
  if (grid === null) throw new Error('no grid');
  return getComputedStyle(grid)
    .gridTemplateColumns.replace(/\([^)]*\)/g, (m) => m.replace(/ /g, ''))
    .split(' ')[1];
};

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '?view=tab');
});

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
  localStorage.clear();
});

describe('the saved session card', () => {
  test('folded with sessions: a "Show the saved session" button with the folder glyph and the text "Saved session"', async () => {
    installMatchMedia(false);
    await renderHome(true);

    const button = await screen.findByRole('button', { name: SHOW });
    expect(button).toBe(card());
    expect(button.querySelector('[data-icon]')?.getAttribute('data-icon')).toBe(
      'folder'
    );
    expect(button).toHaveTextContent('Saved session');
    expect(cardTrack()).toBe('52px');
  });

  test('folded with no sessions: no card, and the card track is 0', async () => {
    installMatchMedia(false);
    await renderHome(true, false);

    await screen.findByText('Saved sessions appear here.');
    expect(card()).toBeNull();
    expect(cardTrack()).toBe('0');
  });

  test('unfolded: no card', async () => {
    installMatchMedia(false);
    await renderHome(false);

    await screen.findByRole('button', { name: HERO_ONLY });
    expect(card()).toBeNull();
    expect(cardTrack()).toBe('0');
  });

  test('narrow and folded: the card still shows', async () => {
    installMatchMedia(true);
    await renderHome(true);

    expect(await screen.findByRole('button', { name: SHOW })).toBe(card());
    expect(cardTrack()).toBe('52px');
  });

  test('pressing the card shows the saved session and stores the unfold', async () => {
    installMatchMedia(false);
    const { store } = await renderHome(true);

    fireEvent.click(await screen.findByRole('button', { name: SHOW }));

    expect(
      await screen.findByRole('button', { name: HERO_ONLY })
    ).toBeInTheDocument();
    expect(store.getState().settingsDataState.foldSavedSessionInTabView).toBe(
      false
    );
    expect(card()).toBeNull();
  });

  test("folded: Currently open's pane has no fold button", async () => {
    installMatchMedia(false);
    await renderHome(true);

    await screen.findByRole('button', { name: SHOW });
    expect(
      within(openNowSlot()).queryByRole('button', { name: SHOW })
    ).toBeNull();
    expect(
      within(openNowSlot()).queryByRole('button', { name: FOLD })
    ).toBeNull();
  });

  test('the card hands focus to "Fold the saved session away"', async () => {
    installMatchMedia(false);
    await renderHome(true);

    const button = await screen.findByRole('button', { name: SHOW });
    act(() => button.focus());
    fireEvent.click(button);

    const fold = await within(openNowSlot()).findByRole('button', {
      name: FOLD,
    });
    expect(document.activeElement).toBe(fold);
  });

  test('"Fold the saved session away" hands focus to the card', async () => {
    installMatchMedia(false);
    await renderHome(false);

    const fold = await within(openNowSlot()).findByRole('button', {
      name: FOLD,
    });
    act(() => fold.focus());
    fireEvent.click(fold);

    const button = await screen.findByRole('button', { name: SHOW });
    expect(document.activeElement).toBe(button);
  });

  test('folding with no sessions: focus goes to the heading, and a later save does not take it', async () => {
    installMatchMedia(false);
    const { store } = await renderHome(false, false);

    const fold = await within(openNowSlot()).findByRole('button', {
      name: FOLD,
    });
    act(() => fold.focus());
    fireEvent.click(fold);

    const heading = within(openNowSlot()).getByRole('heading', {
      name: 'Currently open',
    });
    expect(document.activeElement).toBe(heading);

    act(() => {
      store.dispatch(
        saveToTabContainerInternal(
          buildSession({ tabGroupId: 'later', title: 'Later session' })
        )
      );
    });
    expect(await screen.findByRole('button', { name: SHOW })).toBe(card());
    expect(document.activeElement).toBe(heading);
  });
});
