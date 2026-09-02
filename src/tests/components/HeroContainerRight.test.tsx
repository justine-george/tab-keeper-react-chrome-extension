import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import { renderWithProviders } from '../setup/renderWithProviders';
import { getPrettyDate } from '../../utils/functions/local';
import {
  openSearchPanel,
  setSearchInputText,
} from '../../redux/slices/globalStateSlice';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// A factory rather than a shared constant: saveToTabContainerInternal's reducer
// mutates what it is handed and Immer freezes it, so a session reused across
// tests arrives at the second dispatch already frozen and throws.
const buildSession = () => ({
  tabGroupId: 'group-1',
  title: 'Research',
  createdTime: '2026-08-31 09:00:00',
  windowCount: 1,
  tabCount: 1,
  isAutoSave: false,
  isSelected: true,
  windows: [
    {
      windowId: 'win-1',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: 'Morning reading',
      tabs: [
        {
          tabId: 't1',
          favicon: '',
          title: 'Kagi Search',
          url: 'https://kagi.com/',
        },
      ],
    },
  ],
});

describe('HeroContainerRight', () => {
  // KAN-25. createdTime is a local wall clock with no offset, so it cannot be
  // trusted once a session crosses timezones. createdAt is the instant, and the
  // date on screen has to come from it whenever it is there. The two are given
  // deliberately different values so a component still reading createdTime
  // cannot accidentally pass.
  test('renders the date from createdAt, not the stored wall clock', async () => {
    const session = {
      ...buildSession(),
      createdTime: '2026-08-31 09:00:00',
      createdAt: Date.UTC(2027, 2, 4, 12, 0, 0),
    };

    await renderWithProviders(<HeroContainerRight />, {
      seedStore: (store) => {
        store.dispatch(saveToTabContainerInternal(session));
        store.dispatch(selectTabContainer('group-1'));
      },
    });

    expect(
      await screen.findByText(getPrettyDate(session.createdAt))
    ).toBeTruthy();
    expect(screen.queryByText(getPrettyDate('2026-08-31 09:00:00'))).toBeNull();
  });

  test('renders the selected session title', async () => {
    await renderWithProviders(<HeroContainerRight />, {
      seedStore: (store) => {
        store.dispatch(saveToTabContainerInternal(buildSession()));
        store.dispatch(selectTabContainer('group-1'));
      },
    });

    expect(await screen.findByText('Research')).toBeTruthy();
  });

  // KAN-16. Unreachable through the app -- RightPane will not mount this
  // component with nothing selected -- so the assertion is about the component
  // standing on its own terms, not about a crash a user can currently reach.
  test('renders nothing when no session is selected', async () => {
    const { container } = await renderWithProviders(<HeroContainerRight />);

    expect(container.innerHTML).toBe('');
  });

  // The second way the list empties: a session IS selected, but the search
  // filters it away. This is the path that would go live the day the parent's
  // guard and this component's read stop agreeing.
  test('renders nothing when the search filters the selected session away', async () => {
    const { container } = await renderWithProviders(<HeroContainerRight />, {
      seedStore: (store) => {
        store.dispatch(saveToTabContainerInternal(buildSession()));
        store.dispatch(selectTabContainer('group-1'));
        store.dispatch(openSearchPanel());
        store.dispatch(setSearchInputText('nothing matches this'));
      },
    });

    expect(container.innerHTML).toBe('');
  });

  // The guard has to sit below every hook. Returning null above the useEffect
  // that seeds the editable title would change the hook count between these
  // two renders, and React throws "Rendered more hooks than during the previous
  // render" on the second one.
  test('mounts the session when the store goes from nothing selected to selected', async () => {
    const { store } = await renderWithProviders(<HeroContainerRight />);

    store.dispatch(saveToTabContainerInternal(buildSession()));
    store.dispatch(selectTabContainer('group-1'));

    expect(await screen.findByText('Research')).toBeTruthy();
  });
});
