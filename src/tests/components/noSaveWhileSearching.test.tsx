import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import UserInputContainer from '../../components/home/leftpane/UserInputContainer';
import OpenNowColumn from '../../components/home/opennow/OpenNowColumn';
import { setSearchInputText } from '../../redux/slices/globalStateSlice';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { RenderWithProvidersResult } from '../setup/renderWithProviders';
import { SAVE_TAB_CONTAINER_ACTION } from '../../utils/constants/actionTypes';

// N1: while the saved search holds text, nothing can be saved or exported.
// A save into a filtered list is selected but hidden, which blanks the right
// pane.

const SAVE_ALL = 'Save all open windows as a session';

const seed = {
  tabs: [
    { id: 1, title: 'Kagi Search', url: 'https://kagi.com/', active: true },
  ],
  windows: [
    {
      id: 7,
      tabs: [
        { id: 1, title: 'Kagi Search', url: 'https://kagi.com/' },
      ] as chrome.tabs.Tab[],
    },
  ],
};

type Store = RenderWithProvidersResult['store'];
const search = (store: Store, text: string) =>
  act(() => {
    store.dispatch(setSearchInputText(text));
  });
const saves = (seen: string[]) =>
  seen.filter((type) => type === SAVE_TAB_CONTAINER_ACTION);

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('the save row while the saved search holds text', () => {
  test('only the name field is left, and Enter in it saves nothing', async () => {
    const { store, seen } = await renderWithProviders(<UserInputContainer />, {
      seed,
    });
    await screen.findByDisplayValue('Kagi Search');

    search(store, 'kagi');

    expect(screen.queryByLabelText(SAVE_ALL)).toBeNull();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    const field = screen.getByRole('textbox');
    await userEvent.clear(field);
    await userEvent.type(field, 'Typed{Enter}');
    expect(field).toHaveValue('Typed');
    await act(async () => {});
    expect(saves(seen)).toHaveLength(0);
  });

  test('a query of only spaces is no search: both buttons, and Enter saves', async () => {
    const { store, seen } = await renderWithProviders(<UserInputContainer />, {
      seed,
    });
    await screen.findByDisplayValue('Kagi Search');

    search(store, '   ');

    expect(screen.getByLabelText(SAVE_ALL)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More actions' })).toBeTruthy();
    await userEvent.type(screen.getByRole('textbox'), '{Enter}');
    await act(async () => {});
    expect(saves(seen)).toHaveLength(1);
  });

  test('the typed name survives a search, and Enter saves under it once cleared', async () => {
    const { store, seen } = await renderWithProviders(<UserInputContainer />, {
      seed,
    });
    await screen.findByDisplayValue('Kagi Search');
    const field = screen.getByRole('textbox');
    await userEvent.clear(field);
    await userEvent.type(field, 'My name');

    search(store, 'kagi');
    expect(screen.getByRole('textbox')).toHaveValue('My name');
    search(store, '');

    expect(screen.getByLabelText(SAVE_ALL)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('My name');
    await userEvent.type(screen.getByRole('textbox'), '{Enter}');
    await act(async () => {});
    expect(saves(seen)).toHaveLength(1);
    expect(store.getState().tabContainerDataState.tabGroups[0].title).toBe(
      'My name'
    );
  });
});

describe('Open now saves while the saved search holds text', () => {
  const openNowSeed = {
    currentTabId: 10,
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 11, title: 'A', url: 'https://a.test/' }],
      },
      { id: 2, tabs: [{ id: 21, title: 'D', url: 'https://d.test/' }] },
    ],
  };
  const SAVE_EVERY = 'Save all open windows as a session';
  const render = async () => {
    const result = await renderWithProviders(<OpenNowColumn folded={true} />, {
      seed: openNowSeed,
    });
    await screen.findAllByRole('button', { name: /^Switch to tab: / });
    return result;
  };

  test('no Save all and no Save window; both back when the search clears', async () => {
    const { store } = await render();
    expect(screen.getByLabelText(SAVE_EVERY)).toBeInTheDocument();
    expect(
      screen.getAllByLabelText(/^Save window as a session: /).length
    ).toBeGreaterThan(0);

    search(store, 'kagi');
    expect(screen.queryByLabelText(SAVE_EVERY)).toBeNull();
    expect(screen.queryAllByLabelText(/^Save window as a session: /)).toEqual(
      []
    );

    search(store, '');
    expect(screen.getByLabelText(SAVE_EVERY)).toBeInTheDocument();
  });

  test("Open now's own search alone still leaves Save all (O14e hides only Save window)", async () => {
    await render();
    fireEvent.change(screen.getByRole('textbox', { name: /Search open/i }), {
      target: { value: 'D' },
    });
    expect(screen.getByLabelText(SAVE_EVERY)).toBeInTheDocument();
    expect(screen.queryAllByLabelText(/^Save window as a session: /)).toEqual(
      []
    );
  });
});
