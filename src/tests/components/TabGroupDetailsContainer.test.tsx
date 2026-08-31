import { describe, expect, test, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useDispatch } from 'react-redux';

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
  displayToast: vi.fn(),
}));

import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { AppDispatch } from '../../redux/store';

// A factory, not a shared constant: saveToTabContainerInternal's reducer
// mutates and Immer freezes whatever object it is given, so a session reused
// across the two tests below would arrive at the second dispatch already
// frozen from the first and throw on the reducer's own `touch()` call.
const buildSession = () => ({
  tabGroupId: 'group-1',
  title: 'Research',
  createdTime: '2026-08-31 09:00:00',
  windowCount: 1,
  tabCount: 2,
  isAutoSave: false,
  isSelected: true,
  windows: [
    {
      windowId: 'win-1',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 2,
      title: 'Morning reading',
      tabs: [
        {
          tabId: 't1',
          favicon: '',
          title: 'Kagi Search',
          url: 'https://kagi.com/',
        },
        {
          tabId: 't2',
          favicon: '',
          title: 'Hacker News',
          url: 'https://news.ycombinator.com/',
        },
      ],
    },
  ],
});

// TabGroupDetailsContainer dereferences the selected tab group on its very
// first render (filteredTabGroups[0].tabGroupId) -- KAN-39, a known, open,
// deliberately unfixed bug. Mounting it against an empty store therefore
// throws immediately, before a test body would ever get a chance to dispatch
// afterwards -- render() throws synchronously and no post-render dispatch is
// reachable. Seeding via a wrapper that dispatches during its own render body
// keeps the crash path from ever being entered: the dispatches run to
// completion before React renders TabGroupDetailsContainer as this
// component's child in the same synchronous pass, so its first `useSelector`
// read already sees the populated, selected session. Not a component change.
function Seeded() {
  const dispatch: AppDispatch = useDispatch();
  dispatch(saveToTabContainerInternal(buildSession()));
  dispatch(selectTabContainer('group-1'));
  return <TabGroupDetailsContainer />;
}

describe('TabGroupDetailsContainer', () => {
  test('renders the window and its tabs from store state', async () => {
    await renderWithProviders(<Seeded />);

    expect(await screen.findByText('Morning reading')).toBeTruthy();
    expect(screen.getByText('Kagi Search')).toBeTruthy();
    expect(screen.getByText('Hacker News')).toBeTruthy();
  });

  test('clicking a tab opens it via the chrome fake', async () => {
    const { chrome } = await renderWithProviders(<Seeded />, {
      seed: { tabs: [{ id: 1, index: 0, active: true }] },
    });

    await userEvent.click(await screen.findByText('Kagi Search'));

    expect(chrome.createdTabs.map((tab) => tab.url)).toContain(
      'https://kagi.com/'
    );
  });
});
