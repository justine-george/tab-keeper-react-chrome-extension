import { afterEach, describe, expect, test } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import MenuContainer from '../../components/home/leftpane/MenuContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { OPEN_IN_TAB_MESSAGE } from '../../utils/functions/popOut';

// KAN-279 (Part D, Task 13). The popup's own "open in a tab" button. It only
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
    expect(sortIndex).toBeGreaterThanOrEqual(0);
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
  // being absent) -- the closest this suite can get to a rejection without
  // reaching into the fake's internals. The worker treats a missing windowId
  // as "use the last-focused window" rather than a reason to drop the click.
  test('sends windowId undefined rather than dropping the click when getCurrent has nothing to report', async () => {
    const { chrome } = await renderWithProviders(<MenuContainer />, {
      seed: {},
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open in a tab' }));

    await waitFor(() => expect(chrome.sentMessages).toHaveLength(1));
    expect(chrome.sentMessages).toEqual([
      { type: OPEN_IN_TAB_MESSAGE, windowId: undefined },
    ]);
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
