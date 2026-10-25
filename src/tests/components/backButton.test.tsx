import { afterEach, describe, expect, test } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import MenuContainer from '../../components/home/leftpane/MenuContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import {
  markClosesThisTabCardAnswered,
  setDefaultView,
} from '../../redux/slices/settingsDataStateSlice';
import { RETURN_FROM_FULL_VIEW_MESSAGE } from '../../utils/functions/backFromFullView';
import { fullViewOriginKey } from '../../utils/functions/fullViewOrigin';
import { recentTabsKey } from '../../utils/functions/recentTabs';
import type { DefaultView } from '../../utils/functions/defaultView';

// KAN-509. Under Default view Full the full view's ⤡ slot is Back; the worker side is backFromFullView.test.ts.

// The full view is tab 7 in window 1.
const renderFullView = (view: DefaultView, seed: Partial<ChromeSeed> = {}) => {
  history.replaceState(null, '', '?view=tab');
  return renderWithProviders(<MenuContainer />, {
    seed: {
      action: {},
      currentTabId: 7,
      windows: [
        {
          id: 1,
          tabs: [
            { id: 6, url: 'https://a.test/' },
            {
              id: 7,
              url: 'chrome-extension://x/index.html?view=tab',
              active: true,
            },
          ],
        },
      ],
      ...seed,
    },
    // Answered: a press acts at once. The first press's card is closesThisTab.test.tsx.
    seedStore: (store) => {
      store.dispatch(setDefaultView(view));
      store.dispatch(markClosesThisTabCardAnswered());
    },
  });
};
const back = () => screen.getByRole('button', { name: 'Back to your tab' });

afterEach(() => {
  history.replaceState(null, '', '?');
});

describe("the full view's Back button (KAN-509)", () => {
  test("Default view Full: Back stands in Open compact view's slot", async () => {
    await renderFullView('full');

    const names = screen.getAllByRole('button').map((el) => el.ariaLabel);
    expect(names.slice(0, 2)).toEqual(['Back to your tab', 'Sort sessions']);
    expect(back()).toHaveTextContent('arrow_back');
    expect(back()).toHaveAttribute('data-tooltip', 'Back to your tab');
  });

  test('Default view Compact: Open compact view as before, no Back', async () => {
    await renderFullView('compact');

    expect(
      screen.getByRole('button', { name: 'Open compact view' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Back to your tab' })
    ).not.toBeInTheDocument();
  });

  test('Default view Full, even where Chrome cannot open the popup: Back needs none', async () => {
    await renderFullView('full', { action: { hasOpenPopup: false } });

    expect(back()).toBeInTheDocument();
  });

  test('a recorded tab to go back to: enabled, and a click sends one message', async () => {
    const { chrome } = await renderFullView('full', {
      sessionArea: {
        [fullViewOriginKey(1)]: { fullViewTabId: 7, originTabId: 6 },
      },
    });

    await waitFor(() => expect(back()).not.toHaveAttribute('aria-disabled'));
    fireEvent.click(back());

    await waitFor(() => expect(chrome.sentMessages).toHaveLength(1));
    expect(chrome.sentMessages).toEqual([
      { type: RETURN_FROM_FULL_VIEW_MESSAGE },
    ]);
  });

  test('nowhere to go (pinned, alone, nothing recorded): disabled, dimmed, and a click sends nothing', async () => {
    const { chrome } = await renderFullView('full', {
      windows: [
        {
          id: 1,
          tabs: [
            {
              id: 7,
              url: 'chrome-extension://x/index.html?view=tab',
              active: true,
              pinned: true,
            },
          ],
        },
      ],
    });

    await waitFor(() =>
      expect(back()).toHaveAttribute('aria-disabled', 'true')
    );
    expect(getComputedStyle(back()).opacity).toBe('0.3');
    fireEvent.click(back());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(chrome.sentMessages).toEqual([]);
  });

  test('a tab opened beside a pinned full view and used: Back comes alive', async () => {
    const { chrome } = await renderFullView('full', {
      windows: [
        {
          id: 1,
          tabs: [
            {
              id: 7,
              url: 'chrome-extension://x/index.html?view=tab',
              active: true,
              pinned: true,
            },
          ],
        },
      ],
    });
    await waitFor(() =>
      expect(back()).toHaveAttribute('aria-disabled', 'true')
    );

    await act(async () => {
      chrome.browser.openTab(1, { id: 8, url: 'https://b.test/' });
      await globalThis.chrome.storage.session.set({
        [recentTabsKey(1)]: [7, 8],
      });
    });

    await waitFor(() => expect(back()).not.toHaveAttribute('aria-disabled'));
  });

  test('a tab opened beside an unpinned full view that was alone: Back comes alive from the tab event alone', async () => {
    const { chrome } = await renderFullView('full', {
      windows: [
        {
          id: 1,
          tabs: [
            {
              id: 7,
              url: 'chrome-extension://x/index.html?view=tab',
              active: true,
            },
          ],
        },
        { id: 2, tabs: [{ id: 20, url: 'https://c.test/' }] },
      ],
    });
    await waitFor(() =>
      expect(back()).toHaveAttribute('aria-disabled', 'true')
    );

    act(() => {
      chrome.browser.openTab(1, { id: 8, url: 'https://b.test/' });
    });

    await waitFor(() => expect(back()).not.toHaveAttribute('aria-disabled'));
  });
});
