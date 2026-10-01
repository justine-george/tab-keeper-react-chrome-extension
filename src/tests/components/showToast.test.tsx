import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import { Toast } from '../../components/common/Toast';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildSession } from '../fixtures/sessionFixture';
import type { makeTestStore } from '../setup/makeStore';
import { initTestI18n } from '../setup/i18nForTests';
import { isToastShowing, toastTexts } from '../setup/toasts';
import { showToast } from '../../redux/slices/globalStateSlice';
import { setFoldSavedSessionInTabView } from '../../redux/slices/settingsDataStateSlice';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-350 Task 1. A toast can carry a Show action: its chip selects the
// session it names (peeking first when the tab view is folded, as a click on
// the row does), then the toast closes. A session that is gone just closes it.

type TestStore = ReturnType<typeof makeTestStore>['store'];

const goToTabView = () => history.replaceState(null, '', '?view=tab');

beforeEach(async () => {
  localStorage.clear();
  await initTestI18n();
});

afterEach(() => {
  history.replaceState(null, '', '/');
  localStorage.clear();
});

// Two sessions, FIRST selected (saved last, so it is on top).
const seedTwo = (store: TestStore) => {
  store.dispatch(
    saveToTabContainerInternal(
      buildSession({ tabGroupId: 'second', title: 'Second session' })
    )
  );
  store.dispatch(
    saveToTabContainerInternal(
      buildSession({ tabGroupId: 'first', title: 'First session' })
    )
  );
  store.dispatch(selectTabContainer('first'));
};

const showMoved = (store: TestStore, tabGroupId: string) =>
  act(async () => {
    await store.dispatch(
      showToast({
        toastText: 'Moved to “{{title}}”',
        toastParams: { title: 'Second session' },
        show: { tabGroupId },
      })
    );
  });

describe('the Show action on a toast (KAN-350)', () => {
  test('Show selects the session and closes the toast', async () => {
    const { store } = await renderWithProviders(<Toast />, {
      seedStore: seedTwo,
    });
    await showMoved(store, 'second');

    fireEvent.click(screen.getByRole('button', { name: 'Show' }));

    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'second'
    );
    expect(isToastShowing(store.getState())).toBe(false);
  });

  test('Show peeks when the tab view is folded', async () => {
    goToTabView();
    const { store } = await renderWithProviders(<Toast />, {
      seedStore: (s) => {
        seedTwo(s);
        s.dispatch(setFoldSavedSessionInTabView(true));
      },
    });
    await showMoved(store, 'second');
    // PREMISE: folded, no peek yet.
    expect(store.getState().globalState.isPeekingSavedSession).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Show' }));

    expect(store.getState().globalState.isPeekingSavedSession).toBe(true);
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'second'
    );
  });

  test('Show does not peek when side by side', async () => {
    goToTabView();
    const { store } = await renderWithProviders(<Toast />, {
      seedStore: (s) => {
        seedTwo(s);
        s.dispatch(setFoldSavedSessionInTabView(false));
      },
    });
    await showMoved(store, 'second');

    fireEvent.click(screen.getByRole('button', { name: 'Show' }));

    expect(store.getState().globalState.isPeekingSavedSession).toBe(false);
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'second'
    );
  });

  // The fold setting is stored true by default, but only the tab view folds.
  test('Show does not peek in the popup', async () => {
    const { store } = await renderWithProviders(<Toast />, {
      seedStore: (s) => {
        seedTwo(s);
        s.dispatch(setFoldSavedSessionInTabView(true));
      },
    });
    await showMoved(store, 'second');

    fireEvent.click(screen.getByRole('button', { name: 'Show' }));

    expect(store.getState().globalState.isPeekingSavedSession).toBe(false);
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'second'
    );
  });

  test('a session that is gone: the toast closes and the selection is unchanged', async () => {
    const { store } = await renderWithProviders(<Toast />, {
      seedStore: seedTwo,
    });
    await showMoved(store, 'deleted-session');

    fireEvent.click(screen.getByRole('button', { name: 'Show' }));

    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'first'
    );
    expect(store.getState().globalState.isPeekingSavedSession).toBe(false);
    expect(isToastShowing(store.getState())).toBe(false);
  });

  test('a gone session does not peek a folded tab view either', async () => {
    goToTabView();
    const { store } = await renderWithProviders(<Toast />, {
      seedStore: (s) => {
        seedTwo(s);
        s.dispatch(setFoldSavedSessionInTabView(true));
      },
    });
    await showMoved(store, 'deleted-session');

    fireEvent.click(screen.getByRole('button', { name: 'Show' }));

    expect(store.getState().globalState.isPeekingSavedSession).toBe(false);
  });

  test('only a toast with show has a Show chip', async () => {
    const { store } = await renderWithProviders(<Toast />, {
      seedStore: seedTwo,
    });
    await act(async () => {
      await store.dispatch(showToast({ toastText: 'Copied' }));
    });
    expect(toastTexts(store.getState())).toEqual(['Copied']);
    expect(screen.queryByRole('button', { name: 'Show' })).toBeNull();
  });

  test('the Show toast uses the offer layout: message ellipsed, chip not shrinking', async () => {
    const { store } = await renderWithProviders(<Toast />, {
      seedStore: seedTwo,
    });
    await showMoved(store, 'second');

    const chip = screen.getByRole('button', { name: 'Show' });
    const toast = chip.closest<HTMLElement>('[data-toast]');
    if (toast === null) throw new Error('no toast');
    expect(getComputedStyle(toast).minWidth).toBe('300px');
    expect(getComputedStyle(toast).width).toBe('max-content');
    expect(getComputedStyle(chip).flexShrink).toBe('0');
    const message = screen.getByText('Moved to “Second session”');
    expect(getComputedStyle(message).textOverflow).toBe('ellipsis');
  });
});
