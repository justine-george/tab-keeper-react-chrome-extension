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
const captions = () =>
  [...document.querySelectorAll('[data-pin-step-caption]')].map(
    (c) => c.textContent
  );

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('the pin guide', () => {
  test('three labelled steps, waiting, opened unlit', async () => {
    await render();
    expect(document.activeElement).toBe(guide());
    expect(captions()).toEqual([
      'Click the puzzle piece',
      'Click the pin next to Tab Keeper',
      'Tab Keeper stays on your toolbar',
    ]);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Waiting for you to pin…'
    );
  });

  test("only steps 1 and 3 draw Chrome's ⋮", async () => {
    await render();
    const kebabs = [...openGuide().querySelectorAll('ol > li')].map(
      (li) =>
        [...li.querySelectorAll('.material-symbols-outlined')].filter(
          (i) => i.textContent === 'more_vert'
        ).length
    );
    expect(kebabs).toEqual([1, 0, 1]);
  });

  test.each(['Skip', 'Close'])(
    '%s dismisses it for good on this machine',
    async (name) => {
      const { store } = await render();
      fireEvent.click(within(openGuide()).getByRole('button', { name }));
      expect(store.getState().settingsDataState.isPinGuideDismissed).toBe(true);
      expect(guide()).not.toBeInTheDocument();
    }
  );

  test('Esc dismisses it for good', async () => {
    const { store } = await render();
    fireEvent(
      openGuide(),
      new Event('cancel', { bubbles: false, cancelable: true })
    );
    expect(store.getState().settingsDataState.isPinGuideDismissed).toBe(true);
    expect(guide()).not.toBeInTheDocument();
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

  // Review Focus 5: Skip inside the closing window closes it once.
  test('Skip after the pin, before the guide closes itself, closes it once', async () => {
    vi.useFakeTimers();
    const { seen, chrome } = await render();

    act(() => chrome.setToolbarPin(true));
    fireEvent.click(within(openGuide()).getByRole('button', { name: 'Skip' }));
    act(() => vi.advanceTimersByTime(2000));

    expect(seen.filter((type) => type === closePinGuide.type)).toHaveLength(1);
  });

  test('Skip after the pin, before the guide closes itself, opens setup once', async () => {
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

    expect(seen.filter((type) => type === openSetup.type)).toHaveLength(1);
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
