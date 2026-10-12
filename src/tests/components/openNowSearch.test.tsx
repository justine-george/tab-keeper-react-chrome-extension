import { createRef } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import OpenNowPane from '../../components/home/opennow/OpenNowPane';
import OpenNowColumn from '../../components/home/opennow/OpenNowColumn';
import { Toast } from '../../components/common/Toast';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';

afterEach(() => cleanup());

const url = (name: string) =>
  `https://${name.toLowerCase().replace(/\s+/g, '-')}.test/`;
const tab = (
  id: number,
  title: string,
  extra: Partial<{ pinned: boolean; groupId: number; active: boolean }> = {}
) => ({
  id,
  title,
  url: url(title),
  pinned: false,
  audible: false,
  ...extra,
});

// W1: Kyoto maps*, Osaka flights, Rail pass. W2: Temple list*, Kyoto stay.
// W3: Laws of UX*. (* = the window's front tab.) Kyoto stay sits BEHIND its
// window's front tab, so a switch to it is a visible change (O6).
const threeWindows = (): ChromeSeed => ({
  windows: [
    {
      id: 1,
      focused: true,
      tabs: [
        tab(11, 'Kyoto maps', { active: true }),
        tab(12, 'Osaka flights'),
        tab(13, 'Rail pass'),
      ],
    },
    {
      id: 2,
      tabs: [tab(21, 'Temple list', { active: true }), tab(22, 'Kyoto stay')],
    },
    { id: 3, tabs: [tab(31, 'Laws of UX', { active: true })] },
  ],
});

// Folded: the pane at any width, never the rail (as openNowClose.test.tsx).
async function renderOpenNow(seed: ChromeSeed) {
  const result = await renderWithProviders(
    <>
      <OpenNowColumn folded={true} />
      <Toast />
    </>,
    { seed }
  );
  await screen.findAllByRole('button', { name: /^Switch to tab: / });
  return result;
}

// The titles of the tab rows on screen, top to bottom.
const drawnTitles = () =>
  screen
    .queryAllByRole('button', { name: /^Switch to tab: / })
    .map((button) => (button.getAttribute('aria-label') ?? '').slice(15));

const field = () => screen.getByRole('textbox', { name: 'Search open tabs' });

describe('the search row in Open now (KAN-330 O14)', () => {
  test('sits at the top of the list box, outside the scroller, and the header is unchanged', async () => {
    await renderOpenNow(threeWindows());
    const row = document.querySelector('[data-open-now-search]');
    const header = document.querySelector('[data-open-now-header]');
    expect(row).not.toBeNull();
    expect(header?.contains(row)).toBe(false);
    // The list box is the header's next sibling; the row is its first child,
    // and the rows scroll in the box's second child, not in the box.
    const box = header?.nextElementSibling;
    expect(box?.firstElementChild).toBe(row);
    expect(
      box?.children[1]?.querySelector('[data-open-window-id]')
    ).not.toBeNull();
  });

  test('↓ in the field moves to the first tab drawn', async () => {
    await renderOpenNow(threeWindows());
    act(() => field().focus());
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Switch to tab: Kyoto maps' })
    );
  });
});

describe('a search draws only the matching tabs (O14a)', () => {
  test('a group band shows only when it holds a match', async () => {
    await renderWithProviders(
      <>
        <OpenNowColumn folded={true} />
        <Toast />
      </>,
      {
        seed: {
          windows: [
            {
              id: 1,
              tabs: [
                tab(11, 'Loose'),
                tab(12, 'G1 kyoto', { groupId: 50 }),
                tab(13, 'G2', { groupId: 50 }),
                tab(14, 'H1', { groupId: 60 }),
              ],
            },
          ],
          tabGroups: [
            { id: 50, title: 'Trip', color: 'blue', windowId: 1 },
            { id: 60, title: 'Home', color: 'red', windowId: 1 },
          ],
        },
        seedStore: (store) => store.dispatch(setHasTabGroupsPermission(true)),
      }
    );
    await screen.findAllByRole('button', { name: /^Switch to tab: / });
    await userEvent.setup().type(field(), 'kyoto');
    expect(document.querySelector('[data-band-id="50"]')).not.toBeNull();
    expect(document.querySelector('[data-band-id="60"]')).toBeNull();
    expect(drawnTitles()).toEqual(['G1 kyoto']);
  });

  test('the pinned line sits under the last pinned tab that is drawn', async () => {
    await renderOpenNow({
      windows: [
        {
          id: 1,
          tabs: [
            tab(11, 'Alpha pin', { pinned: true }),
            tab(12, 'Beta pin', { pinned: true }),
            tab(13, 'Alpha loose'),
          ],
        },
      ],
    });
    await userEvent.setup().type(field(), 'alpha');
    const marked = [...document.querySelectorAll('[data-pinned-boundary]')].map(
      (row) => row.getAttribute('data-open-tab-id')
    );
    expect(marked).toEqual(['11']);
  });

  test('closing the last match hides its window and focus moves on (O7b)', async () => {
    await renderOpenNow(threeWindows());
    await userEvent.setup().type(field(), 'kyoto');
    fireEvent.click(
      screen.getByRole('button', { name: 'Close tab: Kyoto stay' })
    );
    await waitFor(() =>
      expect(document.querySelector('[data-open-window-id="2"]')).toBeNull()
    );
    expect(drawnTitles()).toEqual(['Kyoto maps']);
    // Window 3 is hidden by the search, so the next DRAWN window is Window 1.
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Collapse: Window 1' })
    );
  });

  test('Save all under a search saves every window, hidden ones included', async () => {
    const { store } = await renderOpenNow(threeWindows());
    await userEvent.setup().type(field(), 'osaka');
    fireEvent.click(
      screen.getByRole('button', { name: 'Save all open windows as a session' })
    );
    await waitFor(() =>
      expect(store.getState().tabContainerDataState.tabGroups).toHaveLength(1)
    );
    const [saved] = store.getState().tabContainerDataState.tabGroups;
    expect(saved.windowCount).toBe(3);
    expect(saved.tabCount).toBe(6);
  });

  test('typing before the first read lands does not claim there is no match', async () => {
    await renderWithProviders(
      <OpenNowPane
        windows={null}
        actions={[]}
        headingId="open-now-heading"
        searchText="zzz"
        onSearchTextChange={() => undefined}
        searchInputRef={createRef<HTMLInputElement>()}
      />,
      { seed: threeWindows() }
    );
    expect(screen.queryByText('No open tab matches "zzz"')).toBeNull();
  });

  test('clearing the search draws everything again', async () => {
    await renderOpenNow(threeWindows());
    const user = userEvent.setup();
    await user.type(field(), 'kyoto');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(drawnTitles()).toEqual([
      'Kyoto maps',
      'Osaka flights',
      'Rail pass',
      'Temple list',
      'Kyoto stay',
      'Laws of UX',
    ]);
  });
});

const chevronOf = (windowId: number): HTMLElement => {
  const block = document.querySelector(`[data-open-window-id="${windowId}"]`);
  if (!(block instanceof HTMLElement))
    throw new Error(`no block for window ${windowId}`);
  return within(block).getAllByRole('button')[0];
};

describe('folds during a search (O14d F1)', () => {
  test('a folded window with a match is drawn open while searching', async () => {
    await renderOpenNow(threeWindows());
    fireEvent.click(chevronOf(2)); // fold W2 before searching
    expect(drawnTitles()).not.toContain('Kyoto stay');
    await userEvent.setup().type(field(), 'kyoto');
    expect(drawnTitles()).toEqual(['Kyoto maps', 'Kyoto stay']);
    expect(chevronOf(2)).toHaveAttribute('aria-expanded', 'true');
  });

  test('folding works during a search, and clearing restores the folds from before', async () => {
    await renderOpenNow(threeWindows());
    const user = userEvent.setup();
    fireEvent.click(chevronOf(2)); // folded before: W2
    await user.type(field(), 'kyoto');
    fireEvent.click(chevronOf(1)); // folded during: W1
    expect(drawnTitles()).toEqual(['Kyoto stay']);
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(chevronOf(1)).toHaveAttribute('aria-expanded', 'true');
    expect(chevronOf(2)).toHaveAttribute('aria-expanded', 'false');
  });

  test('each new search starts with every matching window open', async () => {
    await renderOpenNow(threeWindows());
    const user = userEvent.setup();
    await user.type(field(), 'kyoto');
    fireEvent.click(chevronOf(1));
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    await user.type(field(), 'kyoto');
    expect(chevronOf(1)).toHaveAttribute('aria-expanded', 'true');
  });

  test('Esc in the field ends the search too, so the next one starts open', async () => {
    await renderOpenNow(threeWindows());
    const user = userEvent.setup();
    await user.type(field(), 'kyoto');
    fireEvent.click(chevronOf(1));
    await user.keyboard('{Escape}');
    await user.type(field(), 'kyoto');
    expect(chevronOf(1)).toHaveAttribute('aria-expanded', 'true');
  });

  test('Collapse all during a search folds the drawn windows, and not the folds from before', async () => {
    await renderOpenNow(threeWindows());
    const user = userEvent.setup();
    await user.type(field(), 'kyoto');
    await user.click(
      screen.getByRole('button', { name: 'Collapse all windows' })
    );
    expect(drawnTitles()).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(drawnTitles()).toHaveLength(6);
  });
});

describe('↓ and ↑ between the rows (O14d K1)', () => {
  test('↓/↑ move between drawn tabs; ↑ on the first goes back to the field', async () => {
    await renderOpenNow(threeWindows());
    await userEvent.setup().type(field(), 'kyoto');
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    const first = screen.getByRole('button', {
      name: 'Switch to tab: Kyoto maps',
    });
    const second = screen.getByRole('button', {
      name: 'Switch to tab: Kyoto stay',
    });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: 'ArrowDown' }); // last: stays
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(field());
  });

  test('arrows on a × do nothing', async () => {
    await renderOpenNow(threeWindows());
    const close = screen.getByRole('button', { name: 'Close tab: Kyoto maps' });
    act(() => close.focus());
    fireEvent.keyDown(close, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(close);
  });
});
