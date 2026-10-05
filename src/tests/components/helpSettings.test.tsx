import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import {
  selectCategory,
  SettingsCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import { openSettingsPage } from '../../redux/slices/globalStateSlice';
import {
  dismissPinGuide,
  finishSetup,
} from '../../redux/slices/settingsDataStateSlice';
import { OPEN_IN_TAB_MESSAGE } from '../../utils/functions/popOut';
import { newRun } from '../../utils/functions/firstRun';
import { installFakeLocks, type FakeLocks } from '../setup/fakeLocks';

// KAN-7 Help: setup, the pin guide and the tour again, in Settings' own section style.

const UNPINNED: ChromeSeed = {
  windows: [{ id: 7 }],
  action: { isOnToolbar: false },
};
const renderHelp = (seed: ChromeSeed = UNPINNED) =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seed,
    seedStore: (store) => {
      store.dispatch(selectCategory(SettingsCategory.HELP));
    },
  });
const pinState = () =>
  document.querySelector('[data-help]')?.getAttribute('data-pin-state');
const read = (state: string) => waitFor(() => expect(pinState()).toBe(state));
const PIN_ROW = 'Pin to your toolbar';

let locks: FakeLocks;
beforeEach(() => {
  locks = installFakeLocks();
});
afterEach(() => {
  locks.uninstall();
  history.replaceState(null, '', '?');
  localStorage.clear();
});

describe('the Help category', () => {
  test('unpinned: three rows, each a label, a line and a button', async () => {
    await renderHelp();
    await read('unpinned');
    for (const text of [
      'Make Tab Keeper yours',
      'Choose your theme, language, default view and shortcut again.',
      PIN_ROW,
      'Show Tab Keeper next to the address bar, one click away.',
      'Learn the basics',
      'A one-minute tour of this view. Your open tabs and saved sessions stay just as they are.',
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    for (const name of ['Run setup again', 'Show me how', 'Show me around']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  test('pinned: no pin row', async () => {
    await renderHelp({ windows: [{ id: 7 }], action: { isOnToolbar: true } });
    await read('pinned');
    expect(screen.queryByText(PIN_ROW)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show me how' })).toBeNull();
  });

  // CONTROL: every other test here, where Chrome answers.
  test('until Chrome answers, no row is drawn, so none pops in later', async () => {
    await renderHelp({
      windows: [{ id: 7 }],
      action: { isOnToolbar: false, getUserSettingsPending: true },
    });
    const help = document.querySelector('[data-help]');
    expect(help).not.toHaveAttribute('data-pin-state');
    expect(help?.querySelectorAll('button')).toHaveLength(0);
  });

  test('pinning while Help is open hides the pin row', async () => {
    const { chrome } = await renderHelp();
    await read('unpinned');
    act(() => {
      chrome.setToolbarPin(true);
    });
    await read('pinned');
    expect(screen.queryByText(PIN_ROW)).toBeNull();
  });

  test('its sections sit 20px, then 32px apart, in the section style every Settings pane uses', async () => {
    const { container } = await renderHelp();
    await read('unpinned');
    const sections = [
      ...container.querySelectorAll<HTMLElement>('[data-settings-section]'),
    ].map((section) => getComputedStyle(section));
    expect(sections.map((style) => style.marginTop)).toEqual([
      '20px',
      '32px',
      '32px',
    ]);
    for (const style of sections) {
      expect([style.display, style.flexDirection, style.alignItems]).toEqual([
        'flex',
        'column',
        'flex-start',
      ]);
    }
  });

  test('popup: Run setup again marks setup pending and asks for the full view on setup', async () => {
    const { store, chrome } = await renderHelp();
    await read('unpinned');
    store.dispatch(finishSetup());
    fireEvent.click(screen.getByRole('button', { name: 'Run setup again' }));
    expect(store.getState().settingsDataState.setupState).toBe('pending');
    await waitFor(() =>
      expect(chrome.sentMessages).toEqual([
        { type: OPEN_IN_TAB_MESSAGE, windowId: 7, show: 'setup' },
      ])
    );
    expect(store.getState().globalState.isSetupOpen).toBe(false);
  });

  test('popup: Show me how asks for the full view on the guide, and clears no dismissal', async () => {
    const { store, chrome } = await renderHelp();
    store.dispatch(dismissPinGuide());
    await read('unpinned');
    fireEvent.click(screen.getByRole('button', { name: 'Show me how' }));
    await waitFor(() =>
      expect(chrome.sentMessages).toEqual([
        { type: OPEN_IN_TAB_MESSAGE, windowId: 7, show: 'pinGuide' },
      ])
    );
    expect(store.getState().settingsDataState.isPinGuideDismissed).toBe(true);
  });

  test('popup: Show me how dismisses nothing that was not dismissed', async () => {
    const { store, chrome } = await renderHelp();
    await read('unpinned');
    fireEvent.click(screen.getByRole('button', { name: 'Show me how' }));
    await waitFor(() => expect(chrome.sentMessages).toHaveLength(1));
    expect(store.getState().settingsDataState.isPinGuideDismissed).toBe(false);
  });

  test('full view: both open right here, and nothing is sent', async () => {
    history.replaceState(null, '', '?view=tab');
    const { store, chrome } = await renderHelp();
    await read('unpinned');
    fireEvent.click(screen.getByRole('button', { name: 'Run setup again' }));
    expect(store.getState().globalState.isSetupOpen).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Show me how' }));
    expect(store.getState().globalState.isPinGuideOpen).toBe(true);
    expect(chrome.sentMessages).toEqual([]);
  });

  test('Show me around leaves Settings and records the popup run at its save card (R11)', async () => {
    const { store } = await renderHelp();
    await read('unpinned');
    await store.dispatch(openSettingsPage(SettingsCategory.HELP));
    fireEvent.click(screen.getByRole('button', { name: 'Show me around' }));
    await waitFor(() =>
      expect(store.getState().settingsDataState.firstRun).toEqual(
        newRun('popup', 1)
      )
    );
    expect(store.getState().globalState.isSettingsPage).toBe(false);
    expect(store.getState().globalState.isRunHere).toBe(true);
  });

  test('in the full view, Show me around records the run at its Hello (R11)', async () => {
    history.replaceState(null, '', '?view=tab');
    const { store } = await renderHelp();
    await read('unpinned');
    fireEvent.click(screen.getByRole('button', { name: 'Show me around' }));
    await waitFor(() =>
      expect(store.getState().settingsDataState.firstRun).toEqual(
        newRun('full', 0, 'welcome')
      )
    );
  });
});
