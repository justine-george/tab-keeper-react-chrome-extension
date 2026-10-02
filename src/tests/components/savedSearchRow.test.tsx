import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';

import MainContainer from '../../components/MainContainer';
import HeroContainerLeft from '../../components/home/leftpane/HeroContainerLeft';
import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { RenderWithProvidersResult } from '../setup/renderWithProviders';
import {
  closeSettingsPage,
  openSettingsPage,
  setHasTabGroupsPermission,
} from '../../redux/slices/globalStateSlice';
import { saveToTabContainerInternal } from '../../redux/slices/tabContainerDataStateSlice';
import { buildSession } from '../fixtures/sessionFixture';

// KAN-385 S1/S2/S5/R2/R3, and KAN-386. The saved search is a row at the top of
// the saved list, always there; "searching" means the field holds text.

const NAME = 'Search saved tabs';
const T0 = Date.UTC(2026, 8, 9, 12, 0, 0);
const ROW_H = 40;

const box = (top: number): DOMRect =>
  DOMRect.fromRect({ x: 0, y: top, width: 200, height: ROW_H });

// Saved oldest first, each at its own instant, so the list reads newest
// first: Research, Holiday.
const seedTwo = (store: RenderWithProvidersResult['store']) => {
  store.dispatch(setHasTabGroupsPermission(false));
  vi.useFakeTimers();
  try {
    for (const [id, title, at] of [
      ['h', 'Holiday', T0 - 3600_000],
      ['r', 'Research', T0],
    ] as const) {
      vi.setSystemTime(at);
      store.dispatch(
        saveToTabContainerInternal(
          buildSession({ tabGroupId: id, title, createdAt: at })
        )
      );
    }
  } finally {
    vi.useRealTimers();
  }
};

const renderList = () =>
  renderWithProviders(<TabGroupEntryContainer />, { seedStore: seedTwo });

const field = () => screen.getByRole('textbox', { name: NAME });

const type = (text: string) =>
  act(() => {
    fireEvent.change(field(), { target: { value: text } });
  });

const savedRow = () => {
  const row = document.querySelector('[data-saved-search]');
  if (!(row instanceof HTMLElement)) throw new Error('no saved search row');
  return row;
};

// The session rows, read from the saved list's scroller: the right pane has drag rows too.
const sessionRows = () => [
  ...(savedRow().nextElementSibling?.querySelectorAll<HTMLElement>(
    '[data-drag-row-id]'
  ) ?? []),
];

const listedIds = () => sessionRows().map((row) => row.dataset.dragRowId);

const goToTabView = () => history.replaceState(null, '', '?view=tab');

afterEach(() => {
  history.replaceState(null, '', '/');
  document.documentElement.removeAttribute('data-dragging');
});

describe('the saved search row (S1, S2)', () => {
  test('is drawn in the popup, inside the list box and above the scroller', async () => {
    await renderList();

    const row = savedRow();
    expect(within(row).getByRole('textbox', { name: NAME })).toBe(field());
    // The scroller is the row's sibling and holds every session row, not the search.
    const scroller = row.nextElementSibling;
    expect(scroller?.querySelectorAll('[data-drag-row-id]')).toHaveLength(2);
    expect(scroller?.contains(row)).toBe(false);
  });

  test('is drawn in the tab view, where the caption has gone', async () => {
    goToTabView();
    await renderList();

    expect(field()).toBeInTheDocument();
    expect(
      savedRow().nextElementSibling?.querySelectorAll('[data-drag-row-id]')
    ).toHaveLength(2);
    expect(screen.queryByText('Saved sessions')).not.toBeInTheDocument();
  });

  test('is drawn with no sessions at all', async () => {
    await renderWithProviders(<TabGroupEntryContainer />);

    expect(field()).toBeInTheDocument();
    expect(screen.getByText('Empty')).toBeInTheDocument();
  });
});

describe('typing in the row', () => {
  test('narrows the list and labels the counts as matches', async () => {
    await renderList();
    expect(listedIds()).toEqual(['r', 'h']);
    expect(screen.queryByText(/^Matches:/)).not.toBeInTheDocument();

    type('holiday');

    expect(listedIds()).toEqual(['h']);
    expect(screen.getByText(/^Matches:/)).toBeInTheDocument();
  });

  // Review Focus 2: spaces alone are no search.
  test('spaces alone hide nothing, narrow nothing, and keep the spaces', async () => {
    await renderList();

    type('   ');

    expect(field()).toHaveValue('   ');
    expect(listedIds()).toEqual(['r', 'h']);
    expect(screen.queryByText(/^Matches:/)).not.toBeInTheDocument();
    expect(
      sessionRows().filter((row) => row.querySelector('[data-row-actions]'))
    ).toHaveLength(2);
    expect(screen.queryByText(/No saved tab matches/)).not.toBeInTheDocument();
  });

  test('spaces alone leave the session drag on', async () => {
    const { store } = await renderList();
    type('   ');
    const rows = sessionRows();
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () => box(i * ROW_H);
    });

    // Holiday (second, midpoint 60) dropped above Research.
    fireEvent.pointerDown(rows[1], { clientX: 10, clientY: 60, button: 0 });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 30 });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 5 });
    fireEvent.pointerUp(document, { clientX: 10, clientY: 5 });
    fireEvent.click(rows[1], { clientX: 10, clientY: 5 });

    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    ).toEqual(['h', 'r']);
  });
});

describe('clearing the row (S5)', () => {
  test('× clears the text and gives the field focus back', async () => {
    await renderList();
    type('holiday');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    });

    expect(field()).toHaveValue('');
    expect(field()).toHaveFocus();
    expect(listedIds()).toEqual(['r', 'h']);
  });

  test('Esc with text clears it and is consumed', async () => {
    await renderList();
    type('holiday');

    let notPrevented = true;
    act(() => {
      notPrevented = fireEvent.keyDown(field(), { key: 'Escape' });
    });

    expect(notPrevented).toBe(false);
    expect(field()).toHaveValue('');
    expect(listedIds()).toEqual(['r', 'h']);
  });

  test('Esc in an empty field is left alone', async () => {
    await renderList();

    expect(fireEvent.keyDown(field(), { key: 'Escape' })).toBe(true);
  });
});

describe('a search that matches nothing (R3)', () => {
  test('says so with the trimmed text, in place of Empty', async () => {
    await renderList();

    type('  zzz ');

    expect(listedIds()).toEqual([]);
    expect(screen.getByText('No saved tab matches "zzz"')).toBeInTheDocument();
    expect(screen.queryByText('Empty')).not.toBeInTheDocument();
  });
});

// KAN-386: after Settings, the box came back empty while the list stayed
// filtered. Opening Settings now clears the query (Q2).
describe('Settings and back (KAN-386, Q2)', () => {
  test('come back to an empty field and every session', async () => {
    const { store } = await renderWithProviders(<MainContainer />, {
      seedStore: seedTwo,
    });
    await screen.findByRole('textbox', { name: NAME });
    type('Holiday');
    expect(listedIds()).toEqual(['h']);

    await act(async () => {
      await store.dispatch(openSettingsPage(undefined));
    });
    act(() => {
      store.dispatch(closeSettingsPage());
    });

    expect(listedIds()).toEqual(['r', 'h']);
    expect(field()).toHaveValue('');
  });
});

// No mode: the header holds no Search button and no Back row.
describe('the home header', () => {
  test('"Tab Keeper" is plain text, with no Search or Back control', async () => {
    await renderWithProviders(<HeroContainerLeft />);

    expect(screen.getByText('Tab Keeper').closest('button')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Go back' })).toBeNull();
  });
});
