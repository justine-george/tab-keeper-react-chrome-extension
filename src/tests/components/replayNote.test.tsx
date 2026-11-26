import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import ReplayNote from '../../components/tour/ReplayNote';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  closeSettingsPage,
  openReplayNote,
  openSettingsPage,
} from '../../redux/slices/globalStateSlice';
import { recordFirstRun } from '../../redux/slices/settingsDataStateSlice';
import { SettingsCategory } from '../../redux/slices/settingsCategoryStateSlice';
import {
  newReplayRun,
  newRun,
  type FirstRun,
} from '../../utils/functions/firstRun';

// KAN-499. The note after the run, at the header's Settings button.

const NBSP = '\u00a0';
const RECT: DOMRect = {
  x: 300,
  y: 10,
  left: 300,
  top: 10,
  right: 330,
  bottom: 40,
  width: 30,
  height: 30,
  toJSON: () => ({}),
};

let gear: HTMLElement;
beforeEach(() => {
  gear = document.createElement('span');
  gear.setAttribute('data-tour-anchor', 'settings');
  gear.getBoundingClientRect = () => RECT;
  document.body.append(gear);
});
afterEach(() => gear.remove());

const mark = () => document.querySelector<HTMLElement>('[data-coach-mark]');
const placed = () =>
  waitFor(() => expect(mark()).not.toHaveAttribute('aria-hidden'));

const renderOpen = () =>
  renderWithProviders(<ReplayNote />, {
    seedStore: (store) =>
      store.dispatch(
        openReplayNote({
          leadsToSetup: false,
          leadsToEnding: false,
          isAfterHelpTour: false,
        })
      ),
  });

describe('the replay note', () => {
  test('says where to see the tour again, with Got it and no progress line', async () => {
    await renderOpen();
    await placed();
    expect(mark()?.textContent?.replace(/\u00a0/g, ' ')).toContain(
      'Want to see this tour again? Go to Settings › Help › Show me around.'
    );
    expect(screen.getByRole('button', { name: 'Got it' })).toBeVisible();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Skip tutorial' })).toBeNull();
  });

  test('the path breaks only after a separator: each label kept whole, each arrow held to the label before it', async () => {
    await renderOpen();
    await placed();
    expect(mark()?.textContent).toContain(
      `Settings${NBSP}› Help${NBSP}› Show me around`
    );
    const labels = ['Settings', 'Help', 'Show me around'].map((label) =>
      screen.getByText(label, { exact: true })
    );
    for (const label of labels) {
      expect(getComputedStyle(label).whiteSpace).toBe('nowrap');
    }
  });

  test('points at the Settings button', async () => {
    await renderOpen();
    await placed();
    expect(mark()).toHaveAttribute('data-coach-side', 'below');
  });

  test('Got it closes it', async () => {
    const { store } = await renderOpen();
    await placed();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(mark()).toBeNull());
    expect(store.getState().globalState.isReplayNoteOpen).toBe(false);
  });

  test('Esc closes it', async () => {
    const { store } = await renderOpen();
    await placed();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(mark()).toBeNull());
    expect(store.getState().globalState.isReplayNoteOpen).toBe(false);
  });

  test('draws nothing while closed', async () => {
    await renderWithProviders(<ReplayNote />);
    expect(mark()).toBeNull();
  });

  test('hides while Settings is open, and comes back after', async () => {
    const { store } = await renderOpen();
    await placed();
    await act(async () => {
      await store.dispatch(openSettingsPage(undefined));
    });
    expect(mark()).toBeNull();
    act(() => {
      store.dispatch(closeSettingsPage());
    });
    await placed();
  });
});

// KAN-1018. A popup skipper never gets the popup's ending card, so the note carries its story link; everyone else gets it there.
describe('the story link on the note', () => {
  const renderAfter = (run: FirstRun) =>
    renderWithProviders(<ReplayNote />, {
      seedStore: (store) => {
        store.dispatch(recordFirstRun(run));
        store.dispatch(
          openReplayNote({
            leadsToSetup: false,
            leadsToEnding: false,
            isAfterHelpTour: run.isReplay,
          })
        );
      },
    });
  const story = () => screen.queryByRole('button', { name: 'Read the story' });

  test('after a popup skip: Read the story closes the note and opens Settings › About', async () => {
    const { store } = await renderAfter({
      ...newRun('popup', 1),
      ended: 'skipped',
    });
    await placed();
    fireEvent.click(story()!);
    await waitFor(() =>
      expect(store.getState().globalState.isSettingsPage).toBe(true)
    );
    expect(store.getState().globalState.isReplayNoteOpen).toBe(false);
    expect(
      store.getState().settingsCategoryState.find((c) => c.isSelected)?.name
    ).toBe(SettingsCategory.ABOUT);
  });

  test.each<[string, FirstRun]>([
    ['a finished popup tour', { ...newRun('popup', 8), ended: 'finished' }],
    ['a full-view skip', { ...newRun('full', 1), ended: 'skipped' }],
    ['a skipped Help replay', { ...newReplayRun('popup'), ended: 'skipped' }],
  ])('none after %s', async (_, run) => {
    await renderAfter(run);
    await placed();
    expect(screen.getByRole('button', { name: 'Got it' })).toBeVisible();
    expect(story()).toBeNull();
  });
});
