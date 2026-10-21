import { afterEach, describe, expect, test } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import { peekSavedSession } from '../../redux/slices/globalStateSlice';
import { renderWithProviders } from '../setup/renderWithProviders';
import { newestToast } from '../setup/toasts';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { buildChromeTab } from '../fixtures/chromeTab';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { setPresentStartup } from '../../redux/slices/undoRedoSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';

// KAN-581 (picks 1A, 2A). The row's Replace, before Delete, does what the ⋮ menu's Replace this session with open windows does (KAN-468).

const SHOWN = buildSession({
  tabGroupId: 'session-shown',
  title: 'Q4 product roadmap',
  isSelected: true,
});
const OTHER = buildSession({
  tabGroupId: 'session-kyoto',
  title: 'Weekend in Kyoto',
});

const renderList = (view: 'popup' | 'tab' = 'popup') => {
  history.replaceState(null, '', view === 'tab' ? '?view=tab' : '/');
  return renderWithProviders(<TabGroupEntryContainer />, {
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
      store.dispatch(
        replaceState({
          ...buildContainer([SHOWN, OTHER]),
          selectedTabGroupId: SHOWN.tabGroupId,
        })
      );
      store.dispatch(
        setPresentStartup({
          tabContainerDataState: store.getState().tabContainerDataState,
        })
      );
    },
  });
};

const rowActions = (title: string) => {
  const row = screen.getByRole('button', { name: title });
  const actions = row.parentElement?.querySelector('[data-row-actions]');
  if (!(actions instanceof HTMLElement)) throw new Error('no row actions');
  return actions;
};
const labels = (actions: HTMLElement) =>
  within(actions)
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label'));

afterEach(() => {
  history.replaceState(null, '', '/');
});

describe('the row’s Replace (KAN-581)', () => {
  // KAN-582: Delete moved to the header's ⋮.
  test('popup: Open, Switch, Replace', async () => {
    await renderList('popup');

    expect(labels(rowActions('Q4 product roadmap'))).toEqual([
      'Open',
      'Switch',
      'Replace',
    ]);
  });

  test('full view: Open, Replace', async () => {
    const { store } = await renderList('tab');
    // The tab view starts folded; a row's actions show on the session shown (KAN-582).
    act(() => {
      store.dispatch(peekSavedSession());
    });

    expect(labels(rowActions('Q4 product roadmap'))).toEqual([
      'Open',
      'Replace',
    ]);
  });

  test('its tooltip names the whole action, and it is drawn as the menu item is', async () => {
    await renderList();

    const replace = within(rowActions('Q4 product roadmap')).getByRole(
      'button',
      {
        name: 'Replace',
      }
    );
    expect(replace).toHaveAttribute(
      'data-tooltip',
      'Replace this session with open windows'
    );
    expect(replace).toHaveTextContent('browser_updated');
  });

  // KAN-582: only the session shown has row actions, so the row's Replace is that session's.
  test('the session takes the open windows, keeps its name, says so, and stays shown', async () => {
    const user = userEvent.setup();
    const { store } = await renderList();

    await user.click(
      within(rowActions('Q4 product roadmap')).getByRole('button', {
        name: 'Replace',
      })
    );

    await waitFor(() => {
      const shown = store
        .getState()
        .tabContainerDataState.tabGroups.find(
          (s) => s.tabGroupId === SHOWN.tabGroupId
        );
      expect(shown?.windows.flatMap((w) => w.tabs.map((t) => t.url))).toEqual([
        'https://open.test/',
      ]);
    });
    const state = store.getState().tabContainerDataState;
    expect(
      state.tabGroups.find((s) => s.tabGroupId === SHOWN.tabGroupId)?.title
    ).toBe('Q4 product roadmap');
    expect(state.selectedTabGroupId).toBe(SHOWN.tabGroupId);
    expect(
      state.tabGroups
        .find((s) => s.tabGroupId === OTHER.tabGroupId)
        ?.windows.flatMap((w) => w.tabs.map((t) => t.url))
    ).toEqual(OTHER.windows.flatMap((w) => w.tabs.map((t) => t.url)));
    expect(newestToast(store.getState())?.text).toBe(
      TOAST_MESSAGES.SESSION_REPLACED
    );
  });
});
