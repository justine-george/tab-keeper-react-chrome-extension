import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

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
import { toOpenWindows } from '../../utils/functions/openNow';
import type { OpenWindow } from '../../utils/functions/openNow';
import { moveOpenGroup, moveOpenTab } from '../../utils/functions/openNowMoves';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';

// KAN-280 Part E, Task 6c. The Open now pane's rows are the drag engine's
// rows: a tab or a whole group dragged there and released makes the Chrome
// calls openNowMoves.ts makes, and the pane's limits (landingRange,
// acceptsWindow) reach the engine. Nothing is written to the store (O11b).
//
// jsdom has no layout, so each window block, row and group title row is given
// the box a browser would draw, 32px a row:
//
//   W1 block  0..H1    header 0..32, then its rows from 32
//   (gap 8)
//   W2 block  ...      header, then its rows

const ROW = 32;
const GAP = 8;

beforeEach(() => {
  vi.mocked(moveOpenTab).mockClear();
  vi.mocked(moveOpenGroup).mockClear();
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-dragging');
});

const box = (top: number, height: number): DOMRect => ({
  top,
  bottom: top + height,
  left: 0,
  right: 300,
  height,
  width: 300,
  x: 0,
  y: top,
  toJSON: () => ({}),
});

const url = (name: string) => `https://${name}.test/`;

async function snapshot(hasTabGroups: boolean): Promise<OpenWindow[]> {
  const all = await chrome.windows.getAll({
    populate: true,
    windowTypes: ['normal'],
  });
  const groups =
    hasTabGroups && chrome.tabGroups ? await chrome.tabGroups.query({}) : null;
  return toOpenWindows(all, groups, null);
}

function find(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  return el;
}

// Gives every drawn part of `windows` its box, top to bottom, and returns
// where each row and title row sits. A group is its title row, then its
// tabs; its item row spans all of that.
function layOut(
  windows: readonly OpenWindow[],
  folded: ReadonlySet<number> = new Set()
) {
  const top = new Map<string, number>();
  let y = 0;
  for (const window of windows) {
    const start = y;
    y += ROW; // the window's own row
    top.set(`window:${window.id}`, start);
    // A folded window draws its own row alone.
    const drawn = folded.has(window.id) ? [] : window.tabs;
    const seen = new Set<number>();
    for (const tab of drawn) {
      if (tab.groupId !== null && !seen.has(tab.groupId)) {
        seen.add(tab.groupId);
        const members = window.tabs.filter((t) => t.groupId === tab.groupId);
        const groupTop = y;
        const height = ROW * (members.length + 1);
        find(
          `[data-drag-row-id="group:${tab.groupId}"]`
        ).getBoundingClientRect = () => box(groupTop, height);
        find(`[data-fixed-row-id="${tab.groupId}"]`).getBoundingClientRect =
          () => box(groupTop, ROW);
        top.set(`group:${tab.groupId}`, groupTop);
        y += ROW;
      }
      const rowTop = y;
      find(`[data-drag-row-id="${tab.id}"]`).getBoundingClientRect = () =>
        box(rowTop, ROW);
      if (tab.groupId === null) {
        find(`[data-drag-row-id="tab:${tab.id}"]`).getBoundingClientRect = () =>
          box(rowTop, ROW);
      }
      top.set(String(tab.id), rowTop);
      y += ROW;
      const last = window.tabs.filter((t) => t.groupId === tab.groupId).pop();
      if (tab.groupId !== null && last === tab) {
        find(
          `[data-fixed-row-id="${tab.groupId}:tail"]`
        ).getBoundingClientRect = () => box(y, 0);
      }
    }
    const height = y - start;
    find(`[data-drop-window-id="${window.id}"]`).getBoundingClientRect = () =>
      box(start, height);
    y += GAP;
  }
  return top;
}

async function renderPane(seed: ChromeSeed, hasTabGroups: boolean) {
  const onMoved = vi.fn();
  // The fake is installed by renderWithProviders; the snapshot is read from
  // it after, and the pane re-rendered with it.
  const result = await renderWithProviders(
    <OpenNowPane
      windows={null}
      actions={[]}
      headingId="open-now-heading"
      onMoved={onMoved}
    />,
    {
      seed,
      seedStore: (store) =>
        store.dispatch(setHasTabGroupsPermission(hasTabGroups)),
    }
  );
  const windows = await snapshot(hasTabGroups);
  result.rerender(
    <OpenNowPane
      windows={windows}
      actions={[]}
      headingId="open-now-heading"
      onMoved={onMoved}
    />
  );
  await screen.findAllByRole('button', { name: /^Switch to tab: / });
  return { ...result, windows, onMoved, top: layOut(windows) };
}

// Presses `el` at y, crosses the activation distance, holds at `to`, and
// releases there.
function drag(el: HTMLElement, from: number, to: number) {
  fireEvent.pointerDown(el, { clientX: 10, clientY: from, button: 0 });
  fireEvent.pointerMove(document, { clientX: 10, clientY: from + 8 });
  fireEvent.pointerMove(document, { clientX: 10, clientY: to });
  fireEvent.pointerUp(document, { clientX: 10, clientY: to });
}

const tabRow = (id: number) => find(`[data-drag-row-id="${id}"]`);

describe('a tab dragged in Open now moves the real tab', () => {
  // W1 [11*, 12], W2 [21*, 22]
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

  test('B released between C and D lands there in Chrome, and the record is handed on', async () => {
    const { top, onMoved, store } = await renderPane(seed(), false);
    const before = store.getState();
    const d = top.get('22') ?? 0;
    drag(tabRow(12), (top.get('12') ?? 0) + ROW / 2, d + 2);
    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));
    expect(moveOpenTab).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: '12',
        fromWindowId: '1',
        toWindowId: '2',
        toIndex: 1,
      }),
      expect.anything(),
      false
    );
    const b = await chrome.tabs.get(12);
    expect([b.windowId, b.index]).toEqual([2, 1]);
    // O11b: nothing reached the store.
    expect(store.getState()).toBe(before);
  });

  // W1 [11P, 12P, 13*, 14], W2 [21*]
  const pinnedSeed = (): ChromeSeed => ({
    windows: [
      {
        id: 1,
        tabs: [
          { id: 11, url: url('p1'), title: 'P1', pinned: true },
          { id: 12, url: url('p2'), title: 'P2', pinned: true },
          { id: 13, url: url('a'), title: 'A', active: true },
          { id: 14, url: url('b'), title: 'B' },
        ],
      },
      {
        id: 2,
        tabs: [{ id: 21, url: url('c'), title: 'C', active: true }],
      },
    ],
  });

  test('an unpinned tab held over the pinned run lands just below it (landingRange)', async () => {
    const { top, onMoved } = await renderPane(pinnedSeed(), false);
    drag(tabRow(14), (top.get('14') ?? 0) + ROW / 2, (top.get('11') ?? 0) + 2);
    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));
    expect(moveOpenTab).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: '14', toWindowId: '1', toIndex: 2 }),
      expect.anything(),
      false
    );
    expect((await chrome.tabs.get(14)).index).toBe(2);
  });

  test('K1: a pinned tab released over another window moves nothing (acceptsWindow)', async () => {
    const { top, onMoved } = await renderPane(pinnedSeed(), false);
    drag(tabRow(11), (top.get('11') ?? 0) + ROW / 2, (top.get('21') ?? 0) + 2);
    // Let any move the release started settle before asserting none did.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(moveOpenTab).not.toHaveBeenCalled();
    expect(onMoved).not.toHaveBeenCalled();
    const p1 = await chrome.tabs.get(11);
    expect([p1.windowId, p1.index, p1.pinned]).toEqual([1, 0, true]);
  });
});

describe('a group dragged in Open now by its title row moves the real group', () => {
  // W1 [11*, G(12, 13)], W2 [21*, 22]; W3 incognito [31*]
  const seed = (): ChromeSeed => ({
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
      {
        id: 3,
        incognito: true,
        tabs: [{ id: 31, url: url('i'), title: 'I', active: true }],
      },
    ],
    tabGroups: [{ id: 50, title: 'Research', color: 'blue', windowId: 1 }],
  });

  const titleRow = () => find('[data-fixed-row-id="50"]');

  test('released between C and D, the group lands there in Chrome', async () => {
    const { top, onMoved } = await renderPane(seed(), true);
    const groupsMove = vi.spyOn(chrome.tabGroups, 'move');
    drag(
      titleRow(),
      (top.get('group:50') ?? 0) + ROW / 2,
      (top.get('22') ?? 0) + 2
    );
    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));
    expect(moveOpenGroup).toHaveBeenCalledWith(
      { groupId: '50', fromWindowId: '1', toWindowId: '2', toIndex: 1 },
      expect.anything()
    );
    expect(groupsMove).toHaveBeenCalledWith(50, { windowId: 2, index: 1 });
    const g1 = await chrome.tabs.get(12);
    expect([g1.windowId, g1.index, g1.groupId]).toEqual([2, 1, 50]);
  });

  test('O11d: released over an incognito window, the group moves nothing', async () => {
    const { top, onMoved } = await renderPane(seed(), true);
    drag(
      titleRow(),
      (top.get('group:50') ?? 0) + ROW / 2,
      (top.get('31') ?? 0) + 2
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(moveOpenGroup).not.toHaveBeenCalled();
    expect(onMoved).not.toHaveBeenCalled();
  });

  // O11e: without the grant no band is drawn, so there is nothing to hold a
  // group by, and a tab still moves on its own.
  test('without the grant there is no title row to hold', async () => {
    await renderPane(seed(), false);
    expect(document.querySelector('[data-fixed-row-id]')).toBeNull();
    expect(document.querySelector('[data-group-drag-handle]')).toBeNull();
  });
});

// Task 6c fix round 1 (review Important 1, spec O11c). A folded window draws
// no rows, so the engine lands a drop there at index 0 -- and the release must
// land below the window's pinned tabs, where the preview's "under the header"
// can honestly mean, not in the run Chrome refuses a group.
describe('a group dropped on a folded window with pinned tabs', () => {
  // W1 [11*, G(12, 13)], W2 [21P, 22P, 23*]
  const seed = (): ChromeSeed => ({
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
          { id: 21, url: url('p1'), title: 'P1', pinned: true },
          { id: 22, url: url('p2'), title: 'P2', pinned: true },
          { id: 23, url: url('c'), title: 'C', active: true },
        ],
      },
    ],
    tabGroups: [{ id: 50, title: 'Research', color: 'blue', windowId: 1 }],
  });

  test('lands at the first unpinned index in Chrome', async () => {
    const { windows, onMoved } = await renderPane(seed(), true);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse: Window 2' }));
    await waitFor(() =>
      expect(document.querySelector('[data-drag-row-id="21"]')).toBeNull()
    );
    const top = layOut(windows, new Set([2]));
    const groupsMove = vi.spyOn(chrome.tabGroups, 'move');
    drag(
      find('[data-fixed-row-id="50"]'),
      (top.get('group:50') ?? 0) + ROW / 2,
      (top.get('window:2') ?? 0) + ROW / 2
    );
    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));
    expect(moveOpenGroup).toHaveBeenCalledWith(
      { groupId: '50', fromWindowId: '1', toWindowId: '2', toIndex: 0 },
      expect.anything()
    );
    expect(groupsMove).toHaveBeenCalledWith(50, { windowId: 2, index: 2 });
    const g1 = await chrome.tabs.get(12);
    expect([g1.windowId, g1.index, g1.groupId]).toEqual([2, 2, 50]);
  });
});
