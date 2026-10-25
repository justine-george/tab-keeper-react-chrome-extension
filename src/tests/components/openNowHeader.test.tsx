import { createRef } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import OpenNowPane from '../../components/home/opennow/OpenNowPane';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import {
  markClosesThisTabCardAnswered,
  setDefaultView,
} from '../../redux/slices/settingsDataStateSlice';
import { RETURN_FROM_FULL_VIEW_MESSAGE } from '../../utils/functions/backFromFullView';
import { fullViewOriginKey } from '../../utils/functions/fullViewOrigin';
import type { DefaultView } from '../../utils/functions/defaultView';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { TYPE } from '../../styles/scale';
import { rgb } from '../setup/hexColor';

// KAN-576 and KAN-577 (pick A). Open now's header: a session-sized title, and Back to your tab in Add window's corner.

// The full view is tab 7 in window 1, beside tab 6.
const renderPane = (view: DefaultView, seed: Partial<ChromeSeed> = {}) => {
  history.replaceState(null, '', '?view=tab');
  return renderWithProviders(
    <OpenNowPane
      windows={[]}
      actions={[]}
      headingId="open-now-heading"
      searchText=""
      onSearchTextChange={() => undefined}
      searchInputRef={createRef<HTMLInputElement>()}
    />,
    {
      seed: {
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
    }
  );
};
const back = () => screen.getByRole('button', { name: 'Back to your tab' });

afterEach(() => {
  history.replaceState(null, '', '?');
});

describe("Open now's title is a session title's size (KAN-576)", () => {
  test('TYPE.SECTION in TEXT_COLOR, as HeroContainerRight draws a session name', async () => {
    await renderPane('compact');

    const heading = screen.getByRole('heading', { name: 'Currently open' });
    // jsdom resolves rem against its 16px root.
    expect(getComputedStyle(heading).fontSize).toBe(
      `${parseFloat(TYPE.SECTION) * 16}px`
    );
    expect(getComputedStyle(heading).color).toBe(rgb(LIGHT_THEME.TEXT_COLOR));
    expect(getComputedStyle(heading).height).toBe('32px');
  });
});

describe("Open now's Back to your tab (KAN-577, pick A)", () => {
  test.each(['compact', 'full'] as const)(
    'Default view %s: the chip shows, labelled, with its icon',
    async (view) => {
      await renderPane(view);

      expect(back()).toHaveTextContent('Back to your tab');
      expect(back()).toHaveTextContent('arrow_back');
    }
  );

  test('a recorded tab to go back to: enabled, and a click sends one message', async () => {
    const { chrome } = await renderPane('compact', {
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

  // Worst path: nowhere to go must not send a request the worker would act on.
  test('nowhere to go (pinned, alone, nothing recorded): disabled, dimmed, and a click sends nothing', async () => {
    const { chrome } = await renderPane('full', {
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
});
