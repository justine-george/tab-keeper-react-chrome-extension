import { afterEach, describe, expect, test } from 'vitest';
import { act, screen } from '@testing-library/react';

import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import RightPane from '../../components/home/rightpane/RightPane';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { setSearchInputText } from '../../redux/slices/globalStateSlice';

// The empty saved list has one line; the detail pane says where a session will show.

const LINE = 'Saved sessions appear here.';
const line = () => screen.queryByText(LINE);

afterEach(() => localStorage.clear());

describe('the empty list’s line', () => {
  test('an empty list shows it, and no Start here card', async () => {
    await renderWithProviders(<TabGroupEntryContainer />);
    expect(line()).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Start here' })).toBeNull();
  });

  test('a search with nothing saved shows no line', async () => {
    await renderWithProviders(<TabGroupEntryContainer />, {
      seedStore: (store) => {
        store.dispatch(setSearchInputText('trip'));
      },
    });
    expect(line()).toBeNull();
  });

  test('sessions arriving by sync take its place', async () => {
    const { store } = await renderWithProviders(<TabGroupEntryContainer />);
    expect(line()).toBeInTheDocument();
    act(() => {
      store.dispatch(replaceState(buildContainer([buildSession()])));
    });
    expect(line()).toBeNull();
  });

  test('while the first load is still to come, sessions on disk mean no line; after a load of nothing, the line', async () => {
    localStorage.setItem(
      'tabContainerData',
      JSON.stringify(buildContainer([buildSession()]))
    );
    const { store } = await renderWithProviders(<TabGroupEntryContainer />);
    expect(line()).toBeNull();
    act(() => {
      store.dispatch(replaceState(buildContainer([])));
    });
    expect(line()).toBeInTheDocument();
  });
});

describe('the detail pane’s line (kept)', () => {
  test('shows while there are no sessions', async () => {
    await renderWithProviders(<RightPane />);
    expect(
      screen.getByText('A saved session shows its windows and tabs here.')
    ).toBeInTheDocument();
  });
});
