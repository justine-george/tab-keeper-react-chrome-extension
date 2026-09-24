import { afterEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import MenuContainer from '../../components/home/leftpane/MenuContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { OPEN_IN_TAB_MESSAGE } from '../../utils/functions/popOut';

// KAN-279 (Part D). The popup's own "open in a tab" button. It only
// SENDS the message -- openOrFocusTabView (popOut.ts) and background.ts's
// listener are what act on it, covered by their own tests, because the popup
// is destroyed the instant another tab takes focus and cannot wait around to
// see the result.

const render = () =>
  renderWithProviders(<MenuContainer />, {
    seed: { windows: [{ id: 7 }] },
  });

describe('the open-in-a-tab button', () => {
  test('sits before "Sort sessions" in DOM order', async () => {
    await render();

    const buttons = screen.getAllByRole('button').map((el) => el.ariaLabel);
    const popOutIndex = buttons.indexOf('Open in a tab');
    const sortIndex = buttons.indexOf('Sort sessions');

    expect(popOutIndex).toBeGreaterThanOrEqual(0);
    // No separate `sortIndex >= 0` assertion: Sort's own presence is
    // sessionSortMenu.test.tsx's job, and it is not needed here to prove
    // order. `indexOf` answers -1 for a missing element, and `popOutIndex`
    // is already pinned non-negative above, so `popOutIndex < sortIndex`
    // cannot pass by accident against a `sortIndex` of -1 -- that would
    // require popOutIndex to be negative too, which the line above rules out.
    expect(popOutIndex).toBeLessThan(sortIndex);
  });

  test('clicking it sends one openInTab message carrying the current window id', async () => {
    const { chrome } = await render();

    fireEvent.click(screen.getByRole('button', { name: 'Open in a tab' }));

    await waitFor(() => expect(chrome.sentMessages).toHaveLength(1));
    expect(chrome.sentMessages).toEqual([
      { type: OPEN_IN_TAB_MESSAGE, windowId: 7 },
    ]);
  });

  // getCurrent() has nothing to answer when the fake seeds no window at all
  // (chrome.fake.ts's windows.getCurrent returns undefined for `windows[0]`
  // being absent) -- current.id then throws inside the same try block a
  // rejection would land in, and the catch below covers both. This is the
  // no-current-window case, distinct from the test below it, which forces
  // an actual promise rejection.
  test('sends windowId undefined when there is no current window', async () => {
    const { chrome } = await renderWithProviders(<MenuContainer />, {
      seed: {},
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open in a tab' }));

    await waitFor(() => expect(chrome.sentMessages).toHaveLength(1));
    expect(chrome.sentMessages).toEqual([
      { type: OPEN_IN_TAB_MESSAGE, windowId: undefined },
    ]);
  });

  // The control for the test above: a REAL rejection, not a resolved
  // `undefined` that happens to throw on `.id`. vi.spyOn keeps the fake's
  // recording (chrome.sentMessages) intact and only replaces getCurrent's
  // implementation, so the assertion still reads through the same handle
  // renderWithProviders returned.
  test('sends windowId undefined rather than dropping the click when getCurrent rejects', async () => {
    const { chrome } = await render();
    const getCurrentSpy = vi
      .spyOn(globalThis.chrome.windows, 'getCurrent')
      .mockRejectedValue(new Error('no window'));

    try {
      fireEvent.click(screen.getByRole('button', { name: 'Open in a tab' }));

      await waitFor(() => expect(chrome.sentMessages).toHaveLength(1));
      expect(chrome.sentMessages).toEqual([
        { type: OPEN_IN_TAB_MESSAGE, windowId: undefined },
      ]);
    } finally {
      getCurrentSpy.mockRestore();
    }
  });

  test('is absent in the tab view', async () => {
    history.replaceState(null, '', '?view=tab');
    try {
      await render();

      expect(
        screen.queryByRole('button', { name: 'Open in a tab' })
      ).not.toBeInTheDocument();
    } finally {
      history.replaceState(null, '', '?');
    }
  });
});

afterEach(() => {
  // Defensive: a failed assertion inside the tab-view test's try body would
  // skip the finally above only if replaceState itself threw, which it does
  // not -- kept anyway so a future test in this file can never inherit
  // ?view=tab from a prior failure.
  history.replaceState(null, '', '?');
});
