import { afterEach, describe, expect, test } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { newestToast } from '../setup/toasts';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { buildChromeTab } from '../fixtures/chromeTab';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { setPresentStartup } from '../../redux/slices/undoRedoSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';

// KAN-581 (picks 1A, 2A). The row's Replace, before Delete, does what the ⋮ menu's Replace with open windows does (KAN-468).

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
  test('popup: Open, Switch, Replace, Delete', async () => {
    await renderList('popup');

    expect(labels(rowActions('Weekend in Kyoto'))).toEqual([
      'Open',
      'Switch',
      'Replace',
      'Delete',
    ]);
  });

  test('full view: Open, Replace, Delete', async () => {
    await renderList('tab');

    expect(labels(rowActions('Weekend in Kyoto'))).toEqual([
      'Open',
      'Replace',
      'Delete',
    ]);
  });

  test('its tooltip names the whole action, and it is drawn as the menu item is', async () => {
    await renderList();

    const replace = within(rowActions('Weekend in Kyoto')).getByRole('button', {
      name: 'Replace',
    });
    expect(replace).toHaveAttribute('title', 'Replace with open windows');
    expect(replace).toHaveTextContent('browser_updated');
  });

  test('on a row not shown: that session takes the open windows, keeps its name, says so, and the shown session stays shown', async () => {
    const user = userEvent.setup();
    const { store } = await renderList();

    await user.click(
      within(rowActions('Weekend in Kyoto')).getByRole('button', {
        name: 'Replace',
      })
    );

    await waitFor(() => {
      const kyoto = store
        .getState()
        .tabContainerDataState.tabGroups.find(
          (s) => s.tabGroupId === OTHER.tabGroupId
        );
      expect(kyoto?.windows.flatMap((w) => w.tabs.map((t) => t.url))).toEqual([
        'https://open.test/',
      ]);
    });
    const state = store.getState().tabContainerDataState;
    const kyoto = state.tabGroups.find(
      (s) => s.tabGroupId === OTHER.tabGroupId
    );
    expect(kyoto?.title).toBe('Weekend in Kyoto');
    expect(state.selectedTabGroupId).toBe(SHOWN.tabGroupId);
    expect(
      state.tabGroups
        .find((s) => s.tabGroupId === SHOWN.tabGroupId)
        ?.windows.flatMap((w) => w.tabs.map((t) => t.url))
    ).toEqual(SHOWN.windows.flatMap((w) => w.tabs.map((t) => t.url)));
    expect(newestToast(store.getState())?.text).toBe(
      TOAST_MESSAGES.SESSION_REPLACED
    );
  });
});
