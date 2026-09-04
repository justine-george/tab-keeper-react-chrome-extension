import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import {
  renderWithProviders,
  RenderWithProvidersResult,
} from '../setup/renderWithProviders';
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
  // that reads the current tab name would change the hook count between these
  // two renders, and React throws "Rendered more hooks than during the previous
  // render" on the second one.
  //
  // KAN-51 deleted the OTHER effect that used to sit above the guard -- the one
  // seeding the editable title -- so that effect is no longer what this test is
  // protecting. The remaining chrome.tabs.query effect is, and one hook above
  // the guard is all it takes for the transition to matter.
  test('mounts the session when the store goes from nothing selected to selected', async () => {
    const { store } = await renderWithProviders(<HeroContainerRight />);

    store.dispatch(saveToTabContainerInternal(buildSession()));
    store.dispatch(selectTabContainer('group-1'));

    expect(await screen.findByText('Research')).toBeTruthy();
  });

  // KAN-77. The title carried an onClick on a NormalLabel -- a bare
  // `<div onClick>` (Label.tsx:50), so click-to-rename existed for a mouse and
  // did not exist for a keyboard: no tab stop, and announced as static text
  // rather than as a control.
  //
  // The tab-order half of this lives in e2e/a11y-controls.spec.ts, because
  // `locator.focus()` succeeds on a tabindex=-1 element and jsdom has no tab
  // order to walk at all. What jsdom CAN settle is the role and the accessible
  // name, and that is what these assert.
  describe('the session title as a rename control (KAN-77)', () => {
    type Store = RenderWithProvidersResult['store'];

    const renderSelected = (seed: (store: Store) => void = () => {}) =>
      renderWithProviders(<HeroContainerRight />, {
        seedStore: (store) => {
          store.dispatch(saveToTabContainerInternal(buildSession()));
          store.dispatch(selectTabContainer('group-1'));
          seed(store);
        },
      });

    // The control for every role assertion below. The rename Icon owns its own
    // onClick and so already renders role="button" -- it is the proof that
    // getByRole can find a control in this harness at all. Without it, a
    // passing role query below could not be told apart from one that never ran,
    // and the search-mode negative below would prove nothing.
    test('CONTROL: the rename icon is already a named button', async () => {
      await renderSelected();

      expect(
        await screen.findByRole('button', { name: 'Rename session' })
      ).toBeTruthy();
    });

    // The accessible name has to CONTAIN the visible title, not replace it.
    // A bare "Rename session" here would be a fresh WCAG 2.5.3 failure: the
    // visible label is the title, and a voice-control user saying "click
    // Research" would find nothing. Hence the same `action + ': ' + target`
    // shape WindowEntryContainer.tsx:269 already uses.
    test('the title is a button whose name says both the action and the session', async () => {
      await renderSelected();

      expect(
        await screen.findByRole('button', { name: 'Rename session: Research' })
      ).toBeTruthy();
    });

    // Swapping a div for a button must not change what the control DOES.
    // Driven by text so it passes against both markups, pinning the behaviour
    // rather than the role: this is the affordance the alternative fix
    // (deleting the onClick) would have removed.
    test('clicking the title still starts a rename', async () => {
      await renderSelected();

      await userEvent.click(await screen.findByText('Research'));

      expect(screen.getByDisplayValue('Research')).toBeTruthy();
    });

    // In search mode the pane is read-only: the whole action block and the
    // bottom row are `visibility: hidden`, and handleTabGroupTitleClick already
    // declined to open the editor. A button that does nothing is worse than no
    // button, so the title must not be exposed as one here.
    //
    // A role query alone cannot see this -- `<div onClick>` and `<div>` are
    // both non-buttons, so this assertion is green against the pre-fix
    // component too. It is only meaningful because the test above proves the
    // same query DOES find a button in the non-search render.
    test('the title is not a control while the search panel is open', async () => {
      await renderSelected((store) => {
        store.dispatch(openSearchPanel());
        store.dispatch(setSearchInputText('Research'));
      });

      expect(await screen.findByText('Research')).toBeTruthy();
      expect(
        screen.queryByRole('button', { name: /Rename session/ })
      ).toBeNull();
    });

    // The behavioural half of the test above, and the one that would survive
    // someone re-attaching an onClick to the search-mode label: that change is
    // invisible to a role query, because a `<div onClick>` is not a button.
    //
    // Note what protects this. handleTabGroupTitleClick still guards on
    // `!isSearchPanel`, but that guard is now unreachable -- the search branch
    // never wires the handler at all -- and deleting it fails nothing. The
    // render branch is the real protection; this test is what pins it.
    test('clicking the title does not start a rename while searching', async () => {
      await renderSelected((store) => {
        store.dispatch(openSearchPanel());
        store.dispatch(setSearchInputText('Research'));
      });

      await userEvent.click(await screen.findByText('Research'));

      expect(screen.queryByDisplayValue('Research')).toBeNull();
    });
  });
});
