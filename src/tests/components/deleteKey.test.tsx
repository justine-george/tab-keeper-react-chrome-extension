import { describe, expect, test } from 'vitest';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { toastTexts } from '../setup/toasts';
import { recordFirstRun } from '../../redux/slices/settingsDataStateSlice';
import { runShownHere } from '../../redux/slices/globalStateSlice';
import {
  replaceState,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { newRun, type RunStep } from '../../utils/functions/firstRun';
import { TOAST_MESSAGES } from '../../utils/constants/common';

// KAN-592 (picks K1, F2). The Delete key deletes the session whose row has focus, as the
// header ⋮'s Delete session does; the ⋮ shows the key beside that item.

const SHOWN = buildSession({ tabGroupId: 'shown', title: 'Roadmap' });
const OTHER = buildSession({ tabGroupId: 'kyoto', title: 'Kyoto' });

type Os = chrome.runtime.PlatformInfo['os'];

const renderList = (platformOs: Os = 'mac', runStep?: RunStep) =>
  renderWithProviders(<TabGroupEntryContainer />, {
    seed: { platformOs },
    seedStore: (store) => {
      store.dispatch(replaceState(buildContainer([SHOWN, OTHER])));
      store.dispatch(selectTabContainer('shown'));
      if (runStep !== undefined) {
        store.dispatch(
          recordFirstRun({ ...newRun('popup', runStep), sessionId: 'shown' })
        );
        store.dispatch(runShownHere());
      }
    },
  });

type Store = Awaited<ReturnType<typeof renderList>>['store'];
const ids = (store: Store) =>
  store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId);
const row = (title: string) => screen.getByRole('button', { name: title });

describe('the Delete key on a focused session row (KAN-592)', () => {
  test.each([
    ['⌫', { key: 'Backspace' }],
    ['fn ⌫ / Delete', { key: 'Delete' }],
    ['⌘⌫', { key: 'Backspace', metaKey: true }],
  ])('%s deletes that row’s session and says so', async (_, init) => {
    const { store } = await renderList();

    fireEvent.keyDown(row('Kyoto'), init);

    await waitFor(() => expect(ids(store)).toEqual(['shown']));
    expect(toastTexts(store.getState())).toEqual([
      TOAST_MESSAGES.DELETE_TAB_CONTAINER_SUCCESS,
    ]);
  });

  test('a held key’s repeats delete nothing', async () => {
    const { store } = await renderList();

    fireEvent.keyDown(row('Kyoto'), { key: 'Backspace', repeat: true });

    expect(ids(store)).toEqual(['shown', 'kyoto']);
  });

  test.each([
    ['Ctrl', { ctrlKey: true }],
    ['Alt', { altKey: true }],
    ['Shift', { shiftKey: true }],
  ])('%s with the key deletes nothing', async (_, mods) => {
    const { store } = await renderList();

    fireEvent.keyDown(row('Kyoto'), { key: 'Backspace', ...mods });
    fireEvent.keyDown(row('Kyoto'), { key: 'Delete', ...mods });

    expect(ids(store)).toEqual(['shown', 'kyoto']);
  });

  test('other keys on the row do what they did', async () => {
    const { store } = await renderList();

    fireEvent.keyDown(row('Kyoto'), { key: 'a' });
    fireEvent.keyDown(row('Kyoto'), { key: 'Escape' });

    expect(ids(store)).toEqual(['shown', 'kyoto']);
  });

  test('the key prevents the browser’s own handling', async () => {
    await renderList();

    const event = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    row('Kyoto').dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  test('while the tour holds Delete on its session, the key deletes nothing', async () => {
    const { store } = await renderList('mac', 6);

    fireEvent.keyDown(row('Roadmap'), { key: 'Backspace' });

    expect(ids(store)).toEqual(['shown', 'kyoto']);
  });

  test('CONTROL: at another tour step the key deletes as the ⋮ does', async () => {
    const { store } = await renderList('mac', 4);

    fireEvent.keyDown(row('Roadmap'), { key: 'Backspace' });

    await waitFor(() => expect(ids(store)).toEqual(['kyoto']));
  });

  test.each([
    ['mac', 'Backspace Meta+Backspace Delete'],
    ['win', 'Delete Backspace'],
  ] as const)('the row names its keys on %s', async (os, keys) => {
    await renderList(os);
    // Once Chrome has answered, so the PC form is not read before a Mac answer replaces it.
    await act(async () => {
      await chrome.runtime.getPlatformInfo();
    });

    expect(row('Kyoto')).toHaveAttribute('aria-keyshortcuts', keys);
  });
});

describe('the ⋮ shows the key beside Delete session (K1)', () => {
  const renderHeader = (platformOs: Os) =>
    renderWithProviders(<HeroContainerRight />, {
      seed: { platformOs, windows: [{ id: 1 }] },
      seedStore: (store) => {
        store.dispatch(replaceState(buildContainer([SHOWN])));
        store.dispatch(selectTabContainer('shown'));
      },
    });

  test.each([
    ['mac', '⌫'],
    ['win', 'Del'],
    ['linux', 'Del'],
  ] as const)('on %s: %s, hidden from the item’s name', async (os, hint) => {
    await renderHeader(os);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));

    const item = screen.getByRole('menuitem', { name: 'Delete session' });
    await waitFor(() =>
      expect(within(item).getByText(hint)).toHaveAttribute(
        'aria-hidden',
        'true'
      )
    );
  });

  test('other items show no key', async () => {
    await renderHeader('mac');
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));

    // The label is the item's last text: nothing follows it.
    expect(
      screen.getByRole('menuitem', { name: 'Copy all links' }).textContent
    ).toMatch(/Copy all links$/);
  });
});
