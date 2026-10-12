import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { useSelector } from 'react-redux';

import { PinGuideModal } from '../../components/modals/PinGuideModal';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import type { RootState } from '../../redux/store';
import {
  closePinGuide,
  openPinGuide,
  openSetup,
} from '../../redux/slices/globalStateSlice';
import {
  initialState as settingsInitial,
  settingsDataStateSlice,
} from '../../redux/slices/settingsDataStateSlice';

// KAN-7 §4. Mounted behind the same flag MainContainer uses, so a close
// unmounts it as it does in the app.
function Gate() {
  const isOpen = useSelector((s: RootState) => s.globalState.isPinGuideOpen);
  return isOpen ? <PinGuideModal /> : null;
}

const render = (
  action: ChromeSeed['action'] = { isOnToolbar: false },
  i18nMessages?: ChromeSeed['i18nMessages']
) =>
  renderWithProviders(<Gate />, {
    seed: { action, i18nMessages },
    seedStore: (store) => {
      store.dispatch(openPinGuide());
    },
  });

const guide = () =>
  screen.queryByRole('dialog', { name: 'Pin Tab Keeper to your toolbar' });
const openGuide = () =>
  screen.getByRole('dialog', { name: 'Pin Tab Keeper to your toolbar' });

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('the pin guide', () => {
  test('a line under the title says why to pin, and describes the dialog', async () => {
    await render();
    const why = openGuide().querySelector('[data-pin-why]');
    expect(why).toHaveTextContent(
      'Save your windows or bring back a session in one click, from any tab.'
    );
    expect(why?.previousElementSibling).toContainElement(
      screen.getByRole('heading', { name: 'Pin Tab Keeper to your toolbar' })
    );
    expect(openGuide()).toHaveAccessibleDescription(why?.textContent ?? '');
  });

  test('a pin ticks step 3, says so, and closes after 1.5 s without dismissing', async () => {
    vi.useFakeTimers();
    const { store, chrome } = await render();

    act(() => chrome.setToolbarPin(true));
    expect(screen.getByRole('status')).toHaveTextContent('Pinned. Closing…');
    const third = document.querySelectorAll('[data-pin-step-caption]')[2];
    expect(third.querySelector('.material-symbols-outlined')?.textContent).toBe(
      'check'
    );

    act(() => vi.advanceTimersByTime(1499));
    expect(guide()).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(guide()).not.toBeInTheDocument();
    expect(store.getState().settingsDataState.isPinGuideDismissed).toBe(false);
  });

  test('Skip after the pin, before the guide closes itself, closes it once and opens nothing after it', async () => {
    vi.useFakeTimers();
    const { seen, chrome } = await renderWithProviders(<Gate />, {
      seed: { action: { isOnToolbar: false } },
      seedStore: (store) => {
        store.dispatch(
          settingsDataStateSlice.actions.replaceState({
            ...settingsInitial,
            setupState: 'pending',
          })
        );
        store.dispatch(openPinGuide());
      },
    });

    act(() => chrome.setToolbarPin(true));
    fireEvent.click(within(openGuide()).getByRole('button', { name: 'Skip' }));
    act(() => vi.advanceTimersByTime(2000));

    expect(seen.filter((type) => type === openSetup.type)).toHaveLength(0);
    expect(seen.filter((type) => type === closePinGuide.type)).toHaveLength(1);
  });

  // C5: step 2 draws the name Chrome's puzzle menu shows, on one line.
  describe('the name drawn beside the pin', () => {
    const drawnName = () => document.querySelector('[data-pin-app-name]');

    test('is the localized appName, cut with an ellipsis on one line', async () => {
      await render({ isOnToolbar: false }, { appName: 'Tab Keeper Pro' });
      expect(drawnName()?.textContent).toBe('Tab Keeper Pro');
      expect(drawnName()).toHaveStyle({
        'white-space': 'nowrap',
        'text-overflow': 'ellipsis',
        overflow: 'hidden',
      });
    });

    test.each([
      ['no chrome.i18n', undefined],
      ['an empty appName', { appName: '' }],
    ])('%s: falls back to "Tab Keeper"', async (_name, messages) => {
      await render({ isOnToolbar: false }, messages);
      expect(drawnName()?.textContent).toBe('Tab Keeper');
    });
  });
});
