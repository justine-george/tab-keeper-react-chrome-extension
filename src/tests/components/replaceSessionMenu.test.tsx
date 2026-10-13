import { describe, expect, test } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import { renderWithProviders } from '../setup/renderWithProviders';
import { newestToast } from '../setup/toasts';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { buildChromeTab } from '../fixtures/chromeTab';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { setPresentStartup } from '../../redux/slices/undoRedoSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { setSearchInputText } from '../../redux/slices/globalStateSlice';

// KAN-468. Replace takes every open window into this session; KAN-581 moved it from the ⋮ menu to the header row.

const SESSION = buildSession({
  tabGroupId: 'session-kyoto',
  title: 'Weekend in Kyoto',
});

const renderHeader = () =>
  renderWithProviders(<HeroContainerRight />, {
    seed: {
      windows: [
        {
          id: 1,
          tabs: [
            buildChromeTab({
              id: 11,
              windowId: 1,
              url: 'https://open.test/',
              title: 'Open now',
            }),
          ],
        },
      ],
    },
    seedStore: (store) => {
      store.dispatch(replaceState(buildContainer([SESSION])));
      store.dispatch(
        setPresentStartup({
          tabContainerDataState: store.getState().tabContainerDataState,
        })
      );
    },
  });

describe('Replace with open windows', () => {
  test('replaces the shown session with what is open, keeps its name, and says so', async () => {
    const user = userEvent.setup();
    const { store } = await renderHeader();

    await user.click(
      screen.getByRole('button', { name: 'Replace with open windows' })
    );

    await waitFor(() => {
      const s = store.getState().tabContainerDataState.tabGroups[0];
      expect(s.windows.flatMap((w) => w.tabs.map((t) => t.url))).toEqual([
        'https://open.test/',
      ]);
    });
    const s = store.getState().tabContainerDataState.tabGroups[0];
    expect([s.tabGroupId, s.title]).toEqual([
      'session-kyoto',
      'Weekend in Kyoto',
    ]);
    expect(newestToast(store.getState())?.text).toBe(
      TOAST_MESSAGES.SESSION_REPLACED
    );
  });

  // KAN-506. A window with an arrow coming in; Export's ios_share points out.
  test('is drawn with browser_updated', async () => {
    await renderHeader();

    const button = screen.getByRole('button', {
      name: 'Replace with open windows',
    });

    expect(
      button.querySelector('.material-symbols-outlined')?.textContent
    ).toBe('browser_updated');
  });

  // As Open and Switch: a search hides the header's actions on the session.
  test('a search hides it', async () => {
    const { store } = await renderHeader();

    act(() => {
      store.dispatch(setSearchInputText('kyoto'));
    });

    expect(
      screen.queryByRole('button', { name: 'Replace with open windows' })
    ).toBeNull();
  });
});
