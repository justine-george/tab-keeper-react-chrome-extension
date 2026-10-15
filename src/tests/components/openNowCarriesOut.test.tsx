import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';

// Spied, not replaced: the real moves run against the fake.
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
import { CarryLayer } from '../../components/home/CarryLayer';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import { carryEndedAs, currentCarry, endCarry } from '../../redux/carry';
import { endDragHold } from '../../redux/dragHold';
import type { OpenWindow } from '../../utils/functions/openNow';
import { moveOpenGroup, moveOpenTab } from '../../utils/functions/openNowMoves';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import { standInSessionList } from '../setup/standInSessionList';
import {
  ROW,
  box,
  find,
  layOut,
  snapshot,
  tabRow,
  url,
} from '../setup/openNowDragHarness';

// KAN-280 Part F. Open now as a carry source (spec O12c): a tab, a group and a window hand off; nothing over Open now
// takes the card (N4 A); the live tab is untouched. jsdom: rows laid out by layOut (x 0..300), the session list stood in
// left of x 0, and the pane's scroller given its box so "beside the pane" (P1) is measured against something.

const ON_LIST = -50;

// W1 [11 A*, G50(12 G1, 13 G2)], W2 [21 C*, 22 D]
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

const pane = (windows: OpenWindow[] | null) => (
  <>
    <OpenNowPane
      windows={windows}
      actions={[]}
      headingId="open-now-heading"
      searchText=""
      onSearchTextChange={() => undefined}
      searchInputRef={createRef<HTMLInputElement>()}
    />
    <CarryLayer />
  </>
);

async function renderPane(seed: ChromeSeed) {
  const result = await renderWithProviders(pane(null), {
    seed,
    seedStore: (store) => store.dispatch(setHasTabGroupsPermission(true)),
  });
  const windows = await snapshot(true);
  result.rerender(pane(windows));
  await screen.findAllByRole('button', { name: /^Switch to tab: / });
  find('[data-open-now-scroller]').getBoundingClientRect = () => box(0, 2000);
  return { ...result, windows, top: layOut(windows) };
}

let unregisterList = () => {};
beforeEach(() => {
  vi.mocked(moveOpenTab).mockClear();
  vi.mocked(moveOpenGroup).mockClear();
  unregisterList = standInSessionList({
    left: -400,
    right: 0,
    top: 0,
    bottom: 2000,
  }).unregister;
});

afterEach(() => {
  unregisterList();
  act(() => endCarry('cancelled'));
  endDragHold();
  cleanup();
  document.documentElement.removeAttribute('data-dragging');
});

const press = (el: HTMLElement, y: number, x = 10) =>
  fireEvent.pointerDown(el, { clientX: x, clientY: y, button: 0 });
const moveTo = (x: number, y: number) =>
  fireEvent.pointerMove(document, { clientX: x, clientY: y });
const handle = (windowId: number) =>
  find(`[data-open-window-id="${windowId}"] [data-open-window-drag-handle]`);

describe('Open now hands its rows to the carry (KAN-280 Part F)', () => {
  test('a tab is drawn held in the pane, then carried as a live copy from beside it, its row back in place', async () => {
    const { top } = await renderPane(groupSeed());
    const y = (top.get('22') ?? 0) + ROW / 2;
    press(tabRow(22), y);
    moveTo(10, y + 8);
    expect(tabRow(22).hasAttribute('data-drag-held')).toBe(true);
    expect(tabRow(22).hasAttribute('data-held-as-card')).toBe(false);
    expect(currentCarry()).toBeNull();
    moveTo(ON_LIST, y + 8);
    const carry = currentCarry();
    if (carry === null || carry.item.source !== 'live') {
      throw new Error('no live carry');
    }
    expect(carry.item.live.chromeWindowId).toBe(2);
    expect(carry.card).toMatchObject({ kind: 'tab', title: 'D' });
    expect(tabRow(22).hasAttribute('data-drag-held')).toBe(false);
    expect(moveOpenTab).not.toHaveBeenCalled();
  });

  test('a group title row hands its group', async () => {
    const { top } = await renderPane(groupSeed());
    const y = (top.get('group:50') ?? 0) + ROW / 2;
    press(find('[data-fixed-row-id="50"]'), y);
    moveTo(10, y + 8);
    moveTo(ON_LIST, y + 8);
    expect(currentCarry()?.card).toMatchObject({
      kind: 'group',
      title: 'Research',
      tabCount: 2,
    });
    expect(moveOpenGroup).not.toHaveBeenCalled();
  });

  test('a window row is a carry from its first 5px; the chevron never starts one (D3 A)', async () => {
    const { top } = await renderPane(groupSeed());
    const y = (top.get('window:2') ?? 0) + ROW / 2;
    const chevron = screen.getByRole('button', { name: /^Collapse: Window 2/ });
    press(chevron, y);
    moveTo(10, y + 8);
    expect(currentCarry()).toBeNull();
    fireEvent.pointerUp(document, { clientX: 10, clientY: y + 8 });
    press(handle(2), y);
    moveTo(10, y + 6);
    expect(currentCarry()?.card).toEqual({
      kind: 'window',
      title: '',
      number: 2,
      tabCount: 2,
    });
    expect(document.querySelector('[data-drag-held]')).toBeNull();
  });

  test('a click on the window row with no movement still goes to the window (O15)', async () => {
    const { top } = await renderPane(groupSeed());
    const focus = vi.spyOn(chrome.windows, 'update');
    const y = (top.get('window:2') ?? 0) + ROW / 2;
    press(handle(2), y);
    fireEvent.pointerUp(document, { clientX: 10, clientY: y });
    fireEvent.click(
      screen.getByRole('button', { name: 'Go to window: Window 2' })
    );
    expect(focus).toHaveBeenCalledWith(2, { focused: true });
  });

  test('carried back over Open now and let go, the carry is cancelled and nothing moves (N4 A)', async () => {
    const { top, store } = await renderPane(groupSeed());
    const before = store.getState().tabContainerDataState;
    const y = (top.get('22') ?? 0) + ROW / 2;
    press(tabRow(22), y);
    moveTo(10, y + 8);
    moveTo(ON_LIST, y + 8);
    const item = currentCarry()?.item;
    if (item === undefined) throw new Error('no carry');
    moveTo(10, y);
    fireEvent.pointerUp(document, { clientX: 10, clientY: y });
    expect(currentCarry()).toBeNull();
    expect(carryEndedAs(item)).toBe('cancelled');
    expect(moveOpenTab).not.toHaveBeenCalled();
    expect(store.getState().tabContainerDataState).toBe(before);
  });

  // Review Focus 3.
  test('the live tab closing mid-carry changes nothing', async () => {
    const { top, rerender } = await renderPane(groupSeed());
    const y = (top.get('22') ?? 0) + ROW / 2;
    press(tabRow(22), y);
    moveTo(10, y + 8);
    moveTo(ON_LIST, y + 8);
    const item = currentCarry()?.item;
    if (item === undefined || item.source !== 'live') {
      throw new Error('no live carry');
    }
    const urls = item.live.window.tabs.map((t) => t.url);
    await act(async () => {
      await chrome.tabs.remove(22);
    });
    // The pane re-drawn from Chrome's next read, which no longer lists the tab.
    const next = await snapshot(true);
    expect(next.flatMap((w) => w.tabs.map((t) => t.id))).not.toContain(22);
    rerender(pane(next));
    expect(currentCarry()?.item).toBe(item);
    expect(item.live.window.tabs.map((t) => t.url)).toEqual(urls);
    expect(urls).toContain(url('d'));
  });
});
