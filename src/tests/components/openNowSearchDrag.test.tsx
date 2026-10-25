import { createRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Spied, not replaced: the real moves run against the fake, so a test sees
// both what the drop asked for and what Chrome then did.
vi.mock('../../utils/functions/openNowMoves', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../utils/functions/openNowMoves')>();
  return {
    ...actual,
    moveOpenTab: vi.fn(actual.moveOpenTab),
    moveOpenGroup: vi.fn(actual.moveOpenGroup),
  };
});

import OpenNowPane from '../../components/home/opennow/OpenNowPane';
import { currentCarry, endCarry } from '../../redux/carry';
import { endDragHold } from '../../redux/dragHold';
import { standInSessionList } from '../setup/standInSessionList';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import type { OpenWindow } from '../../utils/functions/openNow';
import { moveOpenGroup, moveOpenTab } from '../../utils/functions/openNowMoves';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import {
  ROW,
  box,
  drag,
  expectMoveCarriedOut,
  find,
  layOut,
  snapshot,
  tabRow,
  url,
} from '../setup/openNowDragHarness';

// KAN-330 O14c. While the Open now field holds a search, no tab or group row
// can be picked up; clearing the search turns drag back on. The helpers are
// the ones openNowDrag.test.tsx uses, both importing them from
// setup/openNowDragHarness; the pane is stateful so typing reaches it. Every
// search here is "test", which matches every tab, so every row is still
// drawn and layOut can measure all of them: the search is the only thing
// that differs from the plain drag tests.

beforeEach(() => {
  vi.mocked(moveOpenTab).mockClear();
  vi.mocked(moveOpenGroup).mockClear();
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-dragging');
});

function SearchablePane({ windows }: { windows: OpenWindow[] | null }) {
  const [text, setText] = useState('');
  const [inputRef] = useState(() => createRef<HTMLInputElement>());
  return (
    <OpenNowPane
      windows={windows}
      titleActions={[]}
      headingId="open-now-heading"
      searchText={text}
      onSearchTextChange={setText}
      searchInputRef={inputRef}
    />
  );
}

async function renderSearchable(seed: ChromeSeed, hasTabGroups: boolean) {
  const result = await renderWithProviders(<SearchablePane windows={null} />, {
    seed,
    seedStore: (store) =>
      store.dispatch(setHasTabGroupsPermission(hasTabGroups)),
  });
  const windows = await snapshot(hasTabGroups);
  result.rerender(<SearchablePane windows={windows} />);
  await screen.findAllByRole('button', { name: /^Switch to tab: / });
  return { ...result, windows, top: layOut(windows) };
}

const searchBox = () =>
  screen.getByRole('textbox', { name: 'Search open tabs' });

// W1 [11 A, 12 B], W2 [21 C, 22 D]
const seed = (): ChromeSeed => ({
  windows: [
    {
      id: 1,
      tabs: [
        { id: 11, url: url('a'), title: 'A', active: true },
        { id: 12, url: url('b'), title: 'B' },
      ],
    },
    {
      id: 2,
      tabs: [
        { id: 21, url: url('c'), title: 'C', active: true },
        { id: 22, url: url('d'), title: 'D' },
      ],
    },
  ],
});

// W1 [11 A, G(12, 13)], W2 [21 C, 22 D]
const groupSeed = (): ChromeSeed => ({
  windows: [
    {
      id: 1,
      tabs: [
        { id: 11, url: url('a'), title: 'A', active: true },
        { id: 12, url: url('g1'), title: 'G1', groupId: 50 },
        { id: 13, url: url('g2'), title: 'G2', groupId: 50 },
      ],
    },
    {
      id: 2,
      tabs: [
        { id: 21, url: url('c'), title: 'C', active: true },
        { id: 22, url: url('d'), title: 'D' },
      ],
    },
  ],
  tabGroups: [{ id: 50, title: 'Research', color: 'blue', windowId: 1 }],
});

describe('drag is off while searching (KAN-330 O14c)', () => {
  test('spaces only is no search: drag stays on', async () => {
    const { top } = await renderSearchable(seed(), false);
    await userEvent.setup().type(searchBox(), '   ');
    drag(tabRow(12), (top.get('12') ?? 0) + ROW / 2, (top.get('22') ?? 0) + 2);
    await expectMoveCarriedOut(vi.mocked(moveOpenTab));
  });

  test('with a search held, a group held by its title row moves nothing', async () => {
    const { top } = await renderSearchable(groupSeed(), true);
    const title = find('[data-fixed-row-id="50"]');
    await userEvent.setup().type(searchBox(), 'test');
    expect(find('[data-fixed-row-id="50"]')).toBe(title);
    drag(title, (top.get('group:50') ?? 0) + ROW / 2, (top.get('22') ?? 0) + 2);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(moveOpenGroup).not.toHaveBeenCalled();
    expect((await chrome.tabs.get(12)).windowId).toBe(1);
  });

  test('CONTROL: after clearing the search, the same drag moves the group', async () => {
    const { top } = await renderSearchable(groupSeed(), true);
    const user = userEvent.setup();
    await user.type(searchBox(), 'test');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    drag(
      find('[data-fixed-row-id="50"]'),
      (top.get('group:50') ?? 0) + ROW / 2,
      (top.get('22') ?? 0) + 2
    );
    await expectMoveCarriedOut(vi.mocked(moveOpenGroup));
  });
});

describe('a search that starts while a row is held (KAN-330 O14c)', () => {
  // KAN-330 mid-drag search: the reproduction, and now the guard for
  // KAN-335. `disabled` used to gate only `begin`, so a search that started
  // after pick-up neither cancelled the drag nor was seen by it: the search
  // hid the held row, and the release still moved it, to a place worked out
  // from the rows as they were measured before the filter. A drag that is
  // disabled mid-flight now cancels as Esc does, so nothing moves.
  test('B held past the threshold, then the text changes, then released among the original rows', async () => {
    const { top } = await renderSearchable(seed(), false);
    const from = (top.get('12') ?? 0) + ROW / 2;
    fireEvent.pointerDown(tabRow(12), {
      clientX: 10,
      clientY: from,
      button: 0,
    });
    fireEvent.pointerMove(document, { clientX: 10, clientY: from + 8 });
    // Only D matches, so the held row B is no longer drawn.
    fireEvent.change(searchBox(), { target: { value: 'd.test' } });
    const to = (top.get('22') ?? 0) + 2;
    fireEvent.pointerMove(document, { clientX: 10, clientY: to });
    fireEvent.pointerUp(document, { clientX: 10, clientY: to });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(moveOpenTab).not.toHaveBeenCalled();
  });
});

// KAN-280 Part F (O14c amended B, Q3 A). Under a search a tab row can be carried OUT, as a copy; nothing moves inside
// Open now, and a group or window row still does not pick up.
describe('while searching, a tab row is carried out only (O14c amended B, Q3 A)', () => {
  afterEach(() => {
    endCarry('cancelled');
    endDragHold();
  });

  test('a tab row hands off at once and moves nothing in Open now; a group or window row does not pick up', async () => {
    const { unregister } = standInSessionList({
      left: -400,
      right: 0,
      top: 0,
      bottom: 2000,
    });
    const { top } = await renderSearchable(groupSeed(), true);
    find('[data-open-now-scroller]').getBoundingClientRect = () => box(0, 2000);
    await userEvent.setup().type(searchBox(), 'test');
    const y = (top.get('22') ?? 0) + ROW / 2;
    fireEvent.pointerDown(tabRow(22), { clientX: 10, clientY: y, button: 0 });
    fireEvent.pointerMove(document, { clientX: 10, clientY: y + 8 });
    expect(currentCarry()?.item.source).toBe('live');
    fireEvent.pointerUp(document, {
      clientX: 10,
      clientY: (top.get('11') ?? 0) + 2,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(moveOpenTab).not.toHaveBeenCalled();
    endCarry('cancelled');
    endDragHold();

    const groupY = (top.get('group:50') ?? 0) + ROW / 2;
    fireEvent.pointerDown(find('[data-fixed-row-id="50"]'), {
      clientX: 10,
      clientY: groupY,
      button: 0,
    });
    fireEvent.pointerMove(document, { clientX: -50, clientY: groupY + 8 });
    expect(currentCarry()).toBeNull();
    fireEvent.pointerUp(document, { clientX: -50, clientY: groupY + 8 });

    const windowY = (top.get('window:2') ?? 0) + ROW / 2;
    fireEvent.pointerDown(
      find('[data-open-window-id="2"] [data-open-window-drag-handle]'),
      { clientX: 10, clientY: windowY, button: 0 }
    );
    fireEvent.pointerMove(document, { clientX: 10, clientY: windowY + 8 });
    expect(currentCarry()).toBeNull();
    fireEvent.pointerUp(document, { clientX: 10, clientY: windowY + 8 });
    unregister();
  });
});
