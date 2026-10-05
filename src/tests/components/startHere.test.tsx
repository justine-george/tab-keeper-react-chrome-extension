import { afterEach, describe, expect, test } from 'vitest';
import { act, screen, within } from '@testing-library/react';

import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import RightPane from '../../components/home/rightpane/RightPane';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { setSearchInputText } from '../../redux/slices/globalStateSlice';

// The empty saved list starts here; the detail pane says where sessions will show.

const heading = () => screen.queryByRole('heading', { name: 'Start here' });

afterEach(() => localStorage.clear());

describe('the Start here card', () => {
  test('an empty list shows three steps', async () => {
    await renderWithProviders(<TabGroupEntryContainer />);

    expect(heading()).toBeInTheDocument();
    const steps = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveTextContent(
      /^Type a name, then press .* to save every open window\.$/
    );
    expect(steps[1]).toHaveTextContent('Pick a saved session to see its tabs.');
    expect(steps[2]).toHaveTextContent(
      'Press Open to bring them all back, any time.'
    );
    expect(
      within(steps[0]).getByRole('img', {
        name: 'Save all open windows as a session',
      })
    ).toBeInTheDocument();
  });

  test('the card offers no example: the run is reached from Help', async () => {
    await renderWithProviders(<TabGroupEntryContainer />);
    expect(
      screen.queryByRole('button', { name: 'Try it with an example' })
    ).toBeNull();
  });

  test('a search with nothing saved shows no card', async () => {
    await renderWithProviders(<TabGroupEntryContainer />, {
      seedStore: (store) => {
        store.dispatch(setSearchInputText('trip'));
      },
    });
    expect(heading()).not.toBeInTheDocument();
  });

  test('sessions arriving by sync hide the card', async () => {
    const { store } = await renderWithProviders(<TabGroupEntryContainer />);
    expect(heading()).toBeInTheDocument();

    act(() => {
      store.dispatch(replaceState(buildContainer([buildSession()])));
    });
    expect(heading()).not.toBeInTheDocument();
  });

  // Review Focus 1: an existing user's first frame holds the empty placeholder.
  test('while the first load is still to come, sessions on disk mean no card', async () => {
    localStorage.setItem(
      'tabContainerData',
      JSON.stringify(buildContainer([buildSession()]))
    );
    const { store } = await renderWithProviders(<TabGroupEntryContainer />);
    expect(heading()).not.toBeInTheDocument();

    // CONTROL: once a load has happened, an empty list starts here again.
    act(() => {
      store.dispatch(replaceState(buildContainer([])));
    });
    expect(heading()).toBeInTheDocument();
  });
});

describe('the right-pane line', () => {
  const LINE = 'A saved session shows its windows and tabs here.';

  test('shows while there are no sessions', async () => {
    await renderWithProviders(<RightPane />);
    expect(screen.getByText(LINE)).toBeInTheDocument();
  });

  test('is gone once a session exists', async () => {
    await renderWithProviders(<RightPane />, {
      seedStore: (store) => {
        store.dispatch(
          replaceState({
            ...buildContainer([buildSession({ isSelected: true })]),
            selectedTabGroupId: 'session-1',
          })
        );
      },
    });
    expect(screen.queryByText(LINE)).not.toBeInTheDocument();
  });
});
