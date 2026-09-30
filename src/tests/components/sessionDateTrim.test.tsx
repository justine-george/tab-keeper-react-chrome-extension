import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { screen } from '@testing-library/react';

import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import { renderWithProviders } from '../setup/renderWithProviders';
import { restoreContainer } from '../../redux/slices/tabContainerDataStateSlice';
import { getPrettyDate } from '../../utils/functions/local';
import { buildSession } from '../fixtures/sessionFixture';

// KAN-347. Both panes show a session's date without seconds, and without the
// year while it is this year; hovering either shows the full timestamp.
//
// The clock is pinned: the label depends on what year it is, and real "now"
// moves past any fixture eventually.

const TODAY = new Date(2026, 8, 29, 17, 7, 0);
const EDITED = new Date(2026, 8, 24, 2, 51, 57).getTime();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TODAY);
});
afterEach(() => {
  vi.useRealTimers();
});

const renderBothPanes = () =>
  renderWithProviders(
    <>
      <TabGroupEntryContainer />
      <HeroContainerRight />
    </>,
    {
      seedStore: (store) => {
        const session = {
          ...buildSession(),
          createdAt: new Date(2026, 2, 4, 12, 0).getTime(),
          contentModified: EDITED,
          isSelected: true,
        };
        store.dispatch(
          restoreContainer({
            lastModified: 1,
            selectedTabGroupId: session.tabGroupId,
            tabGroups: [session],
            deletedTabGroups: [],
          })
        );
      },
    }
  );

describe('session dates in both panes (KAN-347)', () => {
  test('the row and the header drop the seconds and this year', async () => {
    await renderBothPanes();

    // Row and header: two places, one label.
    expect(await screen.findAllByText('Edited Sep 24, 2:51 AM')).toHaveLength(
      2
    );
  });

  // The hover holds what the label trimmed away. closest('[title]') finds the
  // nearest titled box, so a title on some other ancestor (the row's own, say)
  // answers wrongly rather than passing.
  test('hovering either shows the full timestamp', async () => {
    await renderBothPanes();

    const labels = await screen.findAllByText('Edited Sep 24, 2:51 AM');
    expect(
      labels.map((el) => el.closest('[title]')?.getAttribute('title'))
    ).toEqual([getPrettyDate(EDITED, 'en'), getPrettyDate(EDITED, 'en')]);
  });
});
