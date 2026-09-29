import { createRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
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
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import type { OpenWindow } from '../../utils/functions/openNow';
import { moveOpenGroup, moveOpenTab } from '../../utils/functions/openNowMoves';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import {
  ROW,
  drag,
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

function SearchablePane({
  windows,
  onMoved,
}: {
  windows: OpenWindow[] | null;
  onMoved: () => void;
}) {
  const [text, setText] = useState('');
  const [inputRef] = useState(() => createRef<HTMLInputElement>());
  return (
    <OpenNowPane
      windows={windows}
      actions={[]}
      headingId="open-now-heading"
      onMoved={onMoved}
      searchText={text}
      onSearchTextChange={setText}
      searchInputRef={inputRef}
    />
  );
}

async function renderSearchable(seed: ChromeSeed, hasTabGroups: boolean) {
  const onMoved = vi.fn();
  const result = await renderWithProviders(
    <SearchablePane windows={null} onMoved={onMoved} />,
    {
      seed,
      seedStore: (store) =>
        store.dispatch(setHasTabGroupsPermission(hasTabGroups)),
    }
  );
  const windows = await snapshot(hasTabGroups);
  result.rerender(<SearchablePane windows={windows} onMoved={onMoved} />);
  await screen.findAllByRole('button', { name: /^Switch to tab: / });
  return { ...result, windows, onMoved, top: layOut(windows) };
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
  test('with a search held, B released between C and D moves nothing', async () => {
    const { top, onMoved } = await renderSearchable(seed(), false);
    const before = tabRow(12);
    await userEvent.setup().type(searchBox(), 'test');
    // The measurements laid on the rows still apply only if typing kept them.
    expect(tabRow(12)).toBe(before);
    drag(before, (top.get('12') ?? 0) + ROW / 2, (top.get('22') ?? 0) + 2);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(moveOpenTab).not.toHaveBeenCalled();
    expect(onMoved).not.toHaveBeenCalled();
    const b = await chrome.tabs.get(12);
    expect([b.windowId, b.index]).toEqual([1, 1]);
  });

  test('CONTROL: after clearing the search, the same drag moves B', async () => {
    const { top, onMoved } = await renderSearchable(seed(), false);
    const user = userEvent.setup();
    await user.type(searchBox(), 'test');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    drag(tabRow(12), (top.get('12') ?? 0) + ROW / 2, (top.get('22') ?? 0) + 2);
    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));
  });

  test('spaces only is no search: drag stays on', async () => {
    const { top, onMoved } = await renderSearchable(seed(), false);
    await userEvent.setup().type(searchBox(), '   ');
    drag(tabRow(12), (top.get('12') ?? 0) + ROW / 2, (top.get('22') ?? 0) + 2);
    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));
  });

  test('with a search held, a group held by its title row moves nothing', async () => {
    const { top, onMoved } = await renderSearchable(groupSeed(), true);
    const title = find('[data-fixed-row-id="50"]');
    await userEvent.setup().type(searchBox(), 'test');
    expect(find('[data-fixed-row-id="50"]')).toBe(title);
    drag(title, (top.get('group:50') ?? 0) + ROW / 2, (top.get('22') ?? 0) + 2);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(moveOpenGroup).not.toHaveBeenCalled();
    expect(onMoved).not.toHaveBeenCalled();
    expect((await chrome.tabs.get(12)).windowId).toBe(1);
  });

  test('CONTROL: after clearing the search, the same drag moves the group', async () => {
    const { top, onMoved } = await renderSearchable(groupSeed(), true);
    const user = userEvent.setup();
    await user.type(searchBox(), 'test');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    drag(
      find('[data-fixed-row-id="50"]'),
      (top.get('group:50') ?? 0) + ROW / 2,
      (top.get('22') ?? 0) + 2
    );
    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));
    expect(moveOpenGroup).toHaveBeenCalledTimes(1);
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
    const { top, onMoved } = await renderSearchable(seed(), false);
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
    expect(onMoved).not.toHaveBeenCalled();
  });
});
