import { afterEach, describe, expect, test } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import RightPane from '../../components/home/rightpane/RightPane';
import { renderWithProviders } from '../setup/renderWithProviders';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { setSearchInputText } from '../../redux/slices/globalStateSlice';
import { recordValueMoment } from '../../redux/slices/settingsDataStateSlice';
import { addSampleSession } from '../../redux/addSampleSession';
import {
  IS_DIRTY_ACTION,
  SAVE_TAB_CONTAINER_ACTION,
} from '../../utils/constants/actionTypes';

// KAN-7 §2. The empty saved list starts here; the detail pane says where
// sessions will show; "Add a sample session" saves one ordinary session.

const NAMES = {
  title: 'Sample: Weekend trip',
  gettingThere: 'Getting there',
  thingsToDo: 'Things to do',
};
const heading = () => screen.queryByRole('heading', { name: 'Start here' });

afterEach(() => localStorage.clear());

describe('the Start here card', () => {
  test('an empty list shows three steps and the sample button', async () => {
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
    expect(
      screen.getByRole('button', { name: 'Add a sample session' })
    ).toBeInTheDocument();
  });

  test('the sample is one ordinary session: selected, saved, synced, and no value moment', async () => {
    const { store, seen } = await renderWithProviders(
      <TabGroupEntryContainer />
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Add a sample session' })
    );

    const { tabGroups, selectedTabGroupId } =
      store.getState().tabContainerDataState;
    expect(tabGroups.map((g) => g.title)).toEqual(['Sample: Weekend trip']);
    expect(tabGroups[0].windows.map((w) => [w.title, w.tabs.length])).toEqual([
      ['Getting there', 3],
      ['Things to do', 2],
    ]);
    expect(selectedTabGroupId).toBe(tabGroups[0].tabGroupId);
    expect(seen).toContain(SAVE_TAB_CONTAINER_ACTION);
    expect(seen).toContain(IS_DIRTY_ACTION);
    expect(seen).not.toContain(recordValueMoment.type);
    expect(store.getState().settingsDataState.lastValueMomentTime).toBe('');
    expect(heading()).not.toBeInTheDocument();
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

// Review Focus 4: at most one sample per press of an empty list.
describe('addSampleSession', () => {
  test('a second press adds nothing', () => {
    const { store } = makeTestStore();
    store.dispatch(addSampleSession(NAMES));
    store.dispatch(addSampleSession(NAMES));
    expect(store.getState().tabContainerDataState.tabGroups).toHaveLength(1);
  });

  test('a session that landed in between means no sample', () => {
    const { store } = makeTestStore();
    store.dispatch(
      replaceState(buildContainer([buildSession({ title: 'Synced' })]))
    );
    store.dispatch(addSampleSession(NAMES));
    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.title)
    ).toEqual(['Synced']);
  });
});
