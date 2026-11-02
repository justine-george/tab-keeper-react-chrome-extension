import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from '@testing-library/react';

import OpenNowPane from '../../components/home/opennow/OpenNowPane';
import { CarryLayer } from '../../components/home/CarryLayer';
import {
  OPEN_NOW_FIRST_TARGET,
  OPEN_NOW_LAST_TARGET,
} from '../../components/home/rightpane/newWindowTarget';
import {
  carryEndedAs,
  carryReceiverAt,
  useCarryCrossedIntoOpenNow,
  endCarry,
  measureCarryReceivers,
  moveCarry,
  setCarryOpens,
  startCarry,
  type CarryCard,
} from '../../redux/carry';
import { liveItem, savedItem } from '../../redux/carriedItem';
import type { CarriedItem } from '../../redux/carriedItem';
import { endDragHold } from '../../redux/dragHold';
import {
  runShownHere,
  setHasTabGroupsPermission,
} from '../../redux/slices/globalStateSlice';
import { recordFirstRun } from '../../redux/slices/settingsDataStateSlice';
import {
  saveToTabContainerInternal,
  type windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { carriedRowId } from '../../utils/functions/carriedView';
import { newRun } from '../../utils/functions/firstRun';
import type { OpenWindow } from '../../utils/functions/openNow';
import {
  isOpenIntoWindowRequest,
  type OpenIntoWindowRequest,
} from '../../utils/functions/openIntoWindow';
import {
  RESTORE_SESSION_MESSAGE,
  type RestoreSessionRequest,
} from '../../utils/functions/windows';
import { live } from '../fixtures/liveSnapshotFixture';
import { buildSession } from '../fixtures/sessionFixture';
import type { ChromeSeed } from '../setup/chrome.fake';
import { hoverRulesFor } from '../setup/hoverRules';
import {
  ROW,
  box,
  find,
  layOut,
  snapshot,
  tabRow,
  url,
} from '../setup/openNowDragHarness';
import {
  renderWithProviders,
  type RenderWithProvidersResult,
} from '../setup/renderWithProviders';
import { standInSessionList } from '../setup/standInSessionList';

// KAN-815. Currently open takes a saved carry: a tab or group lands at a slot
// (the lists adopt it) or in a New window box (the header's, or the block
// below the last window); a window opens a new window from anywhere in the
// pane. jsdom: the pane x 0..300, y 0..2000; its header (everything above the
// scroller) y 0..100; the scroller y 100..2000. The session list is stood in
// left of x 0.

const HEADER_Y = 50;
const LIST_Y = 500;

// W1 [11 A*, 12 B], W2 [21 C*]
const SEED: ChromeSeed = {
  windows: [
    {
      id: 1,
      tabs: [
        { id: 11, url: url('a'), title: 'A', active: true },
        { id: 12, url: url('b'), title: 'B' },
      ],
    },
    { id: 2, tabs: [{ id: 21, url: url('c'), title: 'C', active: true }] },
  ],
};

const SAMPLE = 'sample:x';
const savedWindow = (): windowGroupData => ({
  windowId: 'w1',
  windowHeight: 700,
  windowWidth: 900,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: 3,
  title: '',
  tabs: [
    { tabId: 't1', favicon: '', title: 'One', url: url('one'), pinned: true },
    {
      tabId: 'ga',
      favicon: '',
      title: 'GA',
      url: url('ga'),
      chromeGroupId: 'g1',
    },
    {
      tabId: 'gb',
      favicon: '',
      title: 'GB',
      url: url('gb'),
      chromeGroupId: 'g1',
    },
  ],
  chromeTabGroups: [{ groupId: 'g1', title: 'Work', color: 'blue' }],
  state: 'maximized',
});

const tabOf = (tabGroupId = 'S1'): CarriedItem =>
  savedItem({ kind: 'tab', tabGroupId, windowId: 'w1', tabId: 't1' });
const GROUP: CarriedItem = savedItem({
  kind: 'group',
  tabGroupId: 'S1',
  windowId: 'w1',
  groupId: 'g1',
});
const WINDOW: CarriedItem = savedItem({
  kind: 'window',
  tabGroupId: 'S1',
  windowId: 'w1',
});
const CARD: CarryCard = { kind: 'tab', title: 'One', faviconUrl: '' };

function Probe() {
  return (
    <span data-testid="crossed">{String(useCarryCrossedIntoOpenNow())}</span>
  );
}

const pane = (windows: OpenWindow[] | null, searchText = '') => (
  <>
    <OpenNowPane
      windows={windows}
      titleActions={[]}
      headingId="open-now-heading"
      searchText={searchText}
      onSearchTextChange={() => undefined}
      searchInputRef={createRef<HTMLInputElement>()}
    />
    <CarryLayer />
    <Probe />
  </>
);

let result: RenderWithProvidersResult;
let root: HTMLElement;

async function renderPane(
  options: {
    tour?: boolean;
    sessionId?: string;
    searchText?: string;
    seed?: ChromeSeed;
    saved?: windowGroupData;
  } = {}
) {
  result = await renderWithProviders(pane(null), {
    seed: options.seed ?? SEED,
    seedStore: (store) => {
      store.dispatch(setHasTabGroupsPermission(true));
      store.dispatch(
        saveToTabContainerInternal(
          buildSession({
            tabGroupId: options.sessionId ?? 'S1',
            windows: [options.saved ?? savedWindow()],
          })
        )
      );
      if (options.tour === true) {
        store.dispatch(
          recordFirstRun({ ...newRun('popup', 6), sessionId: SAMPLE })
        );
        store.dispatch(runShownHere());
      }
    },
  });
  const windows = await snapshot(true);
  result.rerender(pane(windows, options.searchText));
  await screen.findAllByRole('button', { name: /^Switch to tab: / });
  // A search draws only its matches; nothing below lays rows out under one.
  if (options.searchText === undefined) layOut(windows);
  const region = result.container.querySelector<HTMLElement>('[role="region"]');
  if (region === null) throw new Error('no Open now region');
  root = region;
  root.getBoundingClientRect = () => box(0, 2000);
  find('[data-open-now-scroller]').getBoundingClientRect = () => box(100, 1900);
  return windows;
}

const carry = (item: CarriedItem, x = 10, y = HEADER_Y) =>
  act(() => startCarry(item, CARD, x, y));
const headerBox = () =>
  document.querySelector(`[data-new-window-target="${OPEN_NOW_FIRST_TARGET}"]`);
const lastBox = () =>
  document.querySelector(`[data-new-window-target="${OPEN_NOW_LAST_TARGET}"]`);
const opens = () => document.documentElement.hasAttribute('data-carry-opens');
const restores = () =>
  result.chrome.sentMessages.filter(
    (m): m is RestoreSessionRequest =>
      (m as { type?: unknown }).type === RESTORE_SESSION_MESSAGE
  );
const receiver = (x = 10, y = HEADER_Y) => {
  const r = carryReceiverAt(x, y);
  if (r === null) throw new Error('no receiver there');
  return r;
};

let unregisterList = () => {};
beforeEach(() => {
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
  document.querySelectorAll('[data-test-held]').forEach((el) => el.remove());
});

describe('the pane receiver, as a drag measures it', () => {
  test("an Open now drag gets no pane hit: it stays Open now's (Review Focus 4)", async () => {
    await renderPane();
    const y = 32 + ROW / 2;
    fireEvent.pointerDown(tabRow(11), { clientX: 10, clientY: y, button: 0 });
    fireEvent.pointerMove(document, { clientX: 10, clientY: y + 8 });
    // PREMISE: an in-pane drag holds its row.
    expect(tabRow(11).hasAttribute('data-drag-held')).toBe(true);

    expect(measureCarryReceivers()(10, LIST_Y)).toBeNull();
    fireEvent.pointerUp(document, { clientX: 10, clientY: y + 8 });
  });

  test('a saved drag gets the pane box, not a pixel left of it (Review Focus 3), and nothing once the drawer is away', async () => {
    await renderPane();
    const held = document.createElement('div');
    held.setAttribute('data-drag-held', '');
    held.setAttribute('data-test-held', '');
    document.body.append(held);

    const at = measureCarryReceivers();
    expect(at(10, LIST_Y)?.region?.()).toBe(root);
    expect(at(-1, LIST_Y)?.region?.()).toBeUndefined();

    root.parentElement?.setAttribute('data-carry-away', '');
    expect(measureCarryReceivers()(10, LIST_Y)).toBeNull();
    root.parentElement?.removeAttribute('data-carry-away');
  });

  // KAN-820. A drawer still sliding in after a spring is not where it will rest.
  test('answers nothing while the drawer settles, measured or asked', async () => {
    await renderPane();
    carry(tabOf(), 10, LIST_Y);
    // CONTROL: settled, the pane answers.
    expect(measureCarryReceivers()(10, LIST_Y)).not.toBeNull();
    expect(carryReceiverAt(10, LIST_Y)).not.toBeNull();

    root.parentElement?.setAttribute('data-drawer-settling', '');
    expect(measureCarryReceivers()(10, LIST_Y)).toBeNull();
    expect(carryReceiverAt(10, LIST_Y)).toBeNull();
    root.parentElement?.removeAttribute('data-drawer-settling');
  });

  // Demo round 1 (D2): its list keeps it there and lands it as a new window.
  test('an adopted saved tab is never handed back, over the header either', async () => {
    await renderPane();
    carry(tabOf(), 10, LIST_Y);
    const held = document.createElement('div');
    held.setAttribute('data-drag-held', '');
    held.setAttribute('data-test-held', '');
    root.append(held);

    const at = measureCarryReceivers();
    expect(at(10, HEADER_Y)).toBeNull();
    expect(at(10, LIST_Y)).toBeNull();
  });
});

// KAN-352. Open now's resize grip lies over the pane's edge: a saved drag let
// go on it is an ordinary move, never a carry.
describe('the resize grip', () => {
  test('gets no pane hit, measured or asked, while the pane beside it does', async () => {
    await renderPane();
    const grip = document.createElement('div');
    grip.setAttribute('data-resize-grip', '');
    grip.setAttribute('data-test-held', '');
    grip.getBoundingClientRect = () => ({
      ...box(0, 2000),
      left: 0,
      right: 12,
      width: 12,
      x: 0,
    });
    document.body.append(grip);
    const held = document.createElement('div');
    held.setAttribute('data-drag-held', '');
    held.setAttribute('data-test-held', '');
    document.body.append(held);

    const at = measureCarryReceivers();
    expect(at(6, LIST_Y)?.region?.()).toBeUndefined();
    expect(at(20, LIST_Y)?.region?.()).toBe(root);

    carry(tabOf(), 6, LIST_Y);
    expect(carryReceiverAt(6, LIST_Y)?.region?.()).toBeUndefined();
    expect(carryReceiverAt(20, LIST_Y)?.region?.()).toBe(root);
  });

  // KAN-871. Open now's own tab carried back: its margin under the grip is Open now (KAN-611's one edge).
  test("a live carry: the grip's inside half is the pane, just outside it is not", async () => {
    await renderPane();
    const grip = document.createElement('div');
    grip.setAttribute('data-resize-grip', '');
    grip.setAttribute('data-test-held', '');
    grip.getBoundingClientRect = () => ({
      ...box(0, 2000),
      left: -6,
      right: 6,
      width: 12,
      x: -6,
    });
    document.body.append(grip);

    carry(
      liveItem({
        pick: { kind: 'tab', windowId: 'live-w', tabId: 'l1' },
        window: live(),
        chromeWindowId: 7,
      }),
      3,
      LIST_Y
    );
    expect(carryReceiverAt(3, LIST_Y)?.region?.()).toBe(root);
    expect(carryReceiverAt(-3, LIST_Y)?.region?.()).not.toBe(root);
    // A list that adopted it outside the pane asks the measured hit.
    const at = measureCarryReceivers();
    expect(at(3, LIST_Y)?.region?.()).toBe(root);
    expect(at(-3, LIST_Y)?.region?.()).not.toBe(root);
  });
});

describe('what a saved carry shows', () => {
  test('a tab: the header box and the block below the last window, the phantom resting in it', async () => {
    await renderPane();
    carry(tabOf());

    expect(headerBox()).not.toBeNull();
    const block = lastBox();
    expect(
      block?.querySelector('[data-carry-phantom]') ??
        block?.querySelector('[data-drag-row-id]')
    ).toBeInstanceOf(HTMLElement);
    expect(block?.querySelector('[data-phantom-resting-slot]')).toBeInstanceOf(
      HTMLElement
    );
  });

  test("the block's phantom never shares the saved pane's phantom id", async () => {
    await renderPane();
    carry(tabOf());
    expect(
      document.querySelector(`[data-drag-row-id="${carriedRowId(tabOf())}"]`)
    ).toBeNull();
  });

  test('a group: its phantom in the block too', async () => {
    await renderPane();
    carry(GROUP);
    expect(lastBox()).not.toBeNull();
    expect(
      lastBox()?.querySelector('[data-drag-row-id^="group:"]')
    ).toBeInstanceOf(HTMLElement);
  });

  test('a window: the block alone, no phantom; the header keeps its buttons', async () => {
    await renderPane();
    carry(WINDOW);
    expect(lastBox()).not.toBeNull();
    expect(lastBox()?.querySelector('[data-drag-row-id]')).toBeNull();
    expect(headerBox()).toBeNull();
  });

  test('nothing is drawn after the carry ends', async () => {
    await renderPane();
    carry(tabOf());
    act(() => endCarry('cancelled'));
    expect(headerBox()).toBeNull();
    expect(lastBox()).toBeNull();
  });

  test("the rows under a carry don't light on hover", async () => {
    await renderPane();
    const rules = hoverRulesFor(find('[data-open-tab-id="11"]'));
    expect(rules).toContain(':not([data-carrying])');
  });

  // Review M8: a group's title row too.
  test("a group's title row under a carry doesn't light on hover", async () => {
    await renderPane({
      seed: {
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, url: url('a'), title: 'A', active: true },
              { id: 12, url: url('b'), title: 'B', groupId: 50 },
            ],
          },
        ],
        tabGroups: [{ id: 50, title: 'Research', color: 'blue', windowId: 1 }],
      },
    });
    // The row's own fill: a rule whose selector ends at the row's :hover.
    const fills = hoverRulesFor(find('[data-fixed-row-id="50"]'))
      .split('}')
      .filter((rule) => /:hover\s*\{[^{]*background-color/.test(rule));
    expect(fills).not.toEqual([]);
    for (const rule of fills) expect(rule).toContain(':not([data-carrying])');
  });
});

describe('where it takes nothing', () => {
  test("under Currently open's search: no boxes, and a release takes nothing (O14c)", async () => {
    await renderPane({ searchText: 'a' });
    carry(tabOf());
    expect(headerBox()).toBeNull();
    expect(lastBox()).toBeNull();
    const r = receiver();
    r.hover(10, HEADER_Y);
    expect(opens()).toBe(false);
    expect(r.take()).toBe(false);
    expect(restores()).toEqual([]);
  });

  test("the tour's sample while the tour runs: no boxes, and nothing opens", async () => {
    await renderPane({ tour: true, sessionId: SAMPLE });
    carry(tabOf(SAMPLE));
    expect(headerBox()).toBeNull();
    expect(lastBox()).toBeNull();
    const r = receiver();
    r.hover(10, HEADER_Y);
    expect(opens()).toBe(false);
    expect(r.take()).toBe(false);
    expect(restores()).toEqual([]);
  });

  test('a live carry over Open now still dims and takes nothing (N4 A)', async () => {
    await renderPane();
    carry(
      liveItem({
        pick: { kind: 'tab', windowId: 'live-w', tabId: 'l1' },
        window: live(),
        chromeWindowId: 7,
      })
    );
    expect(headerBox()).toBeNull();
    const r = receiver();
    r.hover(10, HEADER_Y);
    expect(
      document.documentElement.hasAttribute('data-carry-over-open-now')
    ).toBe(true);
    expect(opens()).toBe(false);
    expect(r.take()).toBe(false);
    r.leave();
    expect(
      document.documentElement.hasAttribute('data-carry-over-open-now')
    ).toBe(false);
  });
});

describe('a release the pane takes', () => {
  // KAN-853. A new window comes to the front.
  test('a tab over the header: lit, the + on, and a release opens it in one new window, in front', async () => {
    await renderPane();
    const item = tabOf();
    carry(item);
    const r = receiver();

    r.hover(10, HEADER_Y);
    expect(headerBox()?.hasAttribute('data-landing')).toBe(true);
    expect(opens()).toBe(true);

    expect(r.take()).toBe(true);
    // Review I1: a copy, so the source's view comes back.
    expect(carryEndedAs(item)).toBe('copied');
    expect(restores()).toHaveLength(1);
    expect(restores()[0].specs).toHaveLength(1);
    expect(restores()[0].specs[0]).toMatchObject({
      focused: true,
      tabs: [{ tabId: 't1' }],
    });
  });

  test('a tab over the list: nothing lit, and the layer takes nothing there', async () => {
    await renderPane();
    carry(tabOf(), 10, LIST_Y);
    const r = receiver(10, LIST_Y);
    r.hover(10, HEADER_Y);
    r.hover(10, LIST_Y);
    expect(headerBox()?.hasAttribute('data-landing')).toBe(false);
    expect(opens()).toBe(false);
    expect(r.take()).toBe(false);
    expect(restores()).toEqual([]);
  });

  test('a window anywhere: the block below lit, and a release opens it in front, maximized as saved', async () => {
    await renderPane();
    carry(WINDOW, 10, LIST_Y);
    const r = receiver(10, LIST_Y);

    r.hover(10, LIST_Y);
    expect(lastBox()?.hasAttribute('data-landing')).toBe(true);
    expect(opens()).toBe(true);
    r.hover(10, HEADER_Y);
    expect(lastBox()?.hasAttribute('data-landing')).toBe(true);

    expect(r.take()).toBe(true);
    expect(carryEndedAs(WINDOW)).toBe('copied');
    const [spec] = restores()[0].specs;
    expect(spec.focused).toBe(true);
    expect(spec.state).toBe('maximized');
    expect(spec.tabs).toHaveLength(3);
  });

  test('leaving the pane unlights it and takes the + off', async () => {
    await renderPane();
    carry(tabOf());
    const r = receiver();
    r.hover(10, HEADER_Y);
    // The layer moves the carry, then tells the receiver it lost the pointer.
    act(() => moveCarry(-50, HEADER_Y));
    r.leave();
    expect(headerBox()?.hasAttribute('data-landing')).toBe(false);
    expect(opens()).toBe(false);
  });
  // The layer's leave reaches the receiver after an Open now list adopted
  // the carry and set the + from its own landing (the layer's effect cleanup).
  test("a leave while the pointer is still in the pane keeps the list's +", async () => {
    await renderPane();
    carry(tabOf(), 10, LIST_Y);
    const r = receiver(10, LIST_Y);
    act(() => setCarryOpens(true));
    r.leave();
    expect(opens()).toBe(true);
  });
});

// Demo D3 (his pick): once over Currently open, nothing else takes it.
describe('crossed into Currently open', () => {
  const crossed = () => screen.getByTestId('crossed').textContent;
  const takesNothing = () =>
    document.documentElement.hasAttribute('data-carry-crossed-out');

  test('a saved carry has crossed once its pointer is in the pane, and stays crossed outside it', async () => {
    await renderPane();
    carry(tabOf(), -50, LIST_Y);
    expect(crossed()).toBe('false');
    act(() => moveCarry(10, LIST_Y));
    expect(crossed()).toBe('true');
    act(() => moveCarry(-50, LIST_Y));
    expect(crossed()).toBe('true');
  });

  // KAN-820. The once-per-carry box waits for the drawer to rest.
  test('a box read while the drawer settles is not kept', async () => {
    await renderPane();
    const resting = root.getBoundingClientRect;
    root.parentElement?.setAttribute('data-drawer-settling', '');
    root.getBoundingClientRect = () => ({
      ...box(0, 2000),
      left: 380,
      right: 680,
      x: 380,
    });
    carry(tabOf(), 700, LIST_Y);
    root.parentElement?.removeAttribute('data-drawer-settling');
    root.getBoundingClientRect = resting;
    act(() => moveCarry(10, LIST_Y));
    expect(crossed()).toBe('true');
  });

  test('outside the pane once crossed the card reads as taking nothing; back in, it does not', async () => {
    await renderPane();
    carry(tabOf(), -50, LIST_Y);
    // CONTROL: never crossed, outside is the saved side, which takes it.
    expect(takesNothing()).toBe(false);
    act(() => moveCarry(10, LIST_Y));
    expect(takesNothing()).toBe(false);
    act(() => moveCarry(-50, LIST_Y));
    expect(takesNothing()).toBe(true);
    act(() => moveCarry(10, HEADER_Y));
    expect(takesNothing()).toBe(false);
    act(() => endCarry('cancelled'));
    expect(takesNothing()).toBe(false);
  });

  // KAN-352: on the grip a saved drag is an ordinary move, so it crosses nothing.
  test('over the resize grip it has not crossed', async () => {
    await renderPane();
    const grip = document.createElement('div');
    grip.setAttribute('data-resize-grip', '');
    grip.setAttribute('data-test-held', '');
    grip.getBoundingClientRect = () => ({
      ...box(0, 2000),
      left: 0,
      right: 12,
      width: 12,
      x: 0,
    });
    document.body.append(grip);

    carry(tabOf(), 6, LIST_Y);
    expect(crossed()).toBe('false');
    // CONTROL: beside the grip, in the pane.
    act(() => moveCarry(20, LIST_Y));
    expect(crossed()).toBe('true');
  });

  // Demo D6: carried left onto the session list, Currently open showed its targets.
  test('not yet over Currently open, nothing is drawn there; once over, its targets stay', async () => {
    await renderPane();
    carry(tabOf(), -50, LIST_Y);
    expect(headerBox()).toBeNull();
    expect(lastBox()).toBeNull();
    expect(root.querySelector('[data-drag-row-id^="open-now:"]')).toBeNull();

    act(() => moveCarry(10, LIST_Y));
    expect(headerBox()).not.toBeNull();
    expect(lastBox()).not.toBeNull();
    act(() => moveCarry(-50, LIST_Y));
    expect(headerBox()).not.toBeNull();
  });

  test('a window carry, not yet over Currently open: no box below either', async () => {
    await renderPane();
    carry(WINDOW, -50, LIST_Y);
    expect(lastBox()).toBeNull();
    act(() => moveCarry(10, LIST_Y));
    expect(lastBox()).not.toBeNull();
  });

  test("crossed, Currently open's own receiver is still asked", async () => {
    await renderPane();
    carry(tabOf(), 10, LIST_Y);
    act(() => moveCarry(-50, LIST_Y));
    expect(carryReceiverAt(10, HEADER_Y)?.region?.()).toBe(root);
  });

  test('a live carry never reads over: its source is no saved row', async () => {
    await renderPane();
    carry(
      liveItem({
        pick: { kind: 'tab', windowId: 'live-w', tabId: 'l1' },
        window: live(),
        chromeWindowId: 7,
      }),
      10,
      LIST_Y
    );
    expect(crossed()).toBe('false');
  });

  test('a drawer sent away is not crossed into', async () => {
    await renderPane();
    root.parentElement?.setAttribute('data-carry-away', '');
    carry(tabOf(), 10, LIST_Y);
    expect(crossed()).toBe('false');
    root.parentElement?.removeAttribute('data-carry-away');
  });
});

// KAN-892 D. A saved window over an open window lights that whole window, and
// a release adds its tabs there. Here the blocks sit in the list as the
// browser draws them: W1 y 100..196 (its header and two rows), a gap of 8,
// W2 y 204..268. The header is y 0..100; below W2 the list is empty.
describe('a saved window over an open window', () => {
  const W1_Y = 150;
  const GAP_Y = 200;
  const W2_Y = 230;
  const block = (id: number) => find(`[data-open-window-id="${id}"]`);
  const lit = () =>
    [...document.querySelectorAll('[data-open-window-id][data-landing]')].map(
      (el) => el.getAttribute('data-open-window-id')
    );
  const intoWindows = (): OpenIntoWindowRequest[] =>
    result.chrome.sentMessages.filter(isOpenIntoWindowRequest);
  const placeBlocks = () => {
    block(1).getBoundingClientRect = () => box(100, 96);
    block(2).getBoundingClientRect = () => box(204, 64);
  };
  const seedWith = (incognito: boolean, allowed: boolean): ChromeSeed => ({
    ...SEED,
    windows: SEED.windows?.map((w) => (w.id === 2 ? { ...w, incognito } : w)),
    incognitoAllowed: allowed,
  });

  test('over a window, that window lights as one block, the + on, and the box below does not', async () => {
    await renderPane();
    placeBlocks();
    carry(WINDOW, 10, W1_Y);
    const r = receiver(10, W1_Y);

    r.hover(10, W1_Y);
    expect(lit()).toEqual(['1']);
    expect(lastBox()?.hasAttribute('data-landing')).toBe(false);
    expect(opens()).toBe(true);

    r.hover(10, W2_Y);
    expect(lit()).toEqual(['2']);
  });

  test('the gap below a window is still that window: nothing flickers between two', async () => {
    await renderPane();
    placeBlocks();
    carry(WINDOW, 10, GAP_Y);
    const r = receiver(10, GAP_Y);

    r.hover(10, GAP_Y);
    expect(lit()).toEqual(['1']);
    expect(lastBox()?.hasAttribute('data-landing')).toBe(false);
  });

  test('below the last window, and over the header, the box below lights and no window does', async () => {
    await renderPane();
    placeBlocks();
    carry(WINDOW, 10, W1_Y);
    const r = receiver(10, W1_Y);
    r.hover(10, W1_Y);

    r.hover(10, LIST_Y);
    expect(lit()).toEqual([]);
    expect(lastBox()?.hasAttribute('data-landing')).toBe(true);
    expect(opens()).toBe(true);

    r.hover(10, W2_Y);
    expect(lastBox()?.hasAttribute('data-landing')).toBe(false);
    r.hover(10, HEADER_Y);
    expect(lit()).toEqual([]);
    expect(lastBox()?.hasAttribute('data-landing')).toBe(true);
  });

  // A window scrolled up under the header is not under a pointer on the header.
  test('the part of a window scrolled under the header is the header', async () => {
    await renderPane();
    placeBlocks();
    block(1).getBoundingClientRect = () => box(20, 176);
    carry(WINDOW, 10, HEADER_Y);
    const r = receiver(10, HEADER_Y);

    r.hover(10, HEADER_Y);
    expect(lit()).toEqual([]);
    expect(lastBox()?.hasAttribute('data-landing')).toBe(true);
    // CONTROL: its part in the list is the window.
    r.hover(10, W1_Y);
    expect(lit()).toEqual(['1']);
  });

  test('leaving the pane unlights the window and takes the + off', async () => {
    await renderPane();
    placeBlocks();
    carry(WINDOW, 10, W1_Y);
    const r = receiver(10, W1_Y);
    r.hover(10, W1_Y);

    act(() => moveCarry(-50, W1_Y));
    r.leave();
    expect(lit()).toEqual([]);
    expect(opens()).toBe(false);
  });

  test('the blocks are read once while it is over the pane, not on every move', async () => {
    await renderPane();
    placeBlocks();
    let reads = 0;
    const measured = block(2).getBoundingClientRect;
    block(2).getBoundingClientRect = () => {
      reads += 1;
      return measured();
    };
    carry(WINDOW, 10, W1_Y);
    const r = receiver(10, W1_Y);

    for (const y of [W1_Y, W2_Y, GAP_Y, LIST_Y, W2_Y]) r.hover(10, y);
    expect(reads).toBe(1);
    expect(lit()).toEqual(['2']);
  });

  test('back over the pane after leaving it, the blocks are read afresh', async () => {
    await renderPane();
    placeBlocks();
    carry(WINDOW, 10, W1_Y);
    const r = receiver(10, W1_Y);
    r.hover(10, W1_Y);
    act(() => moveCarry(-50, W1_Y));
    r.leave();
    // W2 now drawn lower.
    block(2).getBoundingClientRect = () => box(400, 64);

    act(() => moveCarry(10, 420));
    r.hover(10, 420);
    expect(lit()).toEqual(['2']);
  });

  // The list scrolled under a resting carry (a wheel): the boxes read before
  // still say where each window is, less the distance scrolled.
  test('the list scrolled during the carry: the window now under the pointer lights', async () => {
    await renderPane();
    placeBlocks();
    const scroller = find('[data-open-now-scroller]');
    carry(WINDOW, 10, W1_Y);
    const r = receiver(10, W1_Y);
    r.hover(10, W1_Y);
    // PREMISE: W1 there before the scroll.
    expect(lit()).toEqual(['1']);

    scroller.scrollTop = 80;
    r.hover(10, W1_Y);
    expect(lit()).toEqual(['2']);
    scroller.scrollTop = 0;
  });

  test('a release on a lit window adds the saved window there: nothing activated, unfocused, a copy', async () => {
    await renderPane();
    placeBlocks();
    carry(WINDOW, 10, W2_Y);
    const r = receiver(10, W2_Y);
    r.hover(10, W2_Y);

    expect(r.take()).toBe(true);
    expect(carryEndedAs(WINDOW)).toBe('copied');
    expect(restores()).toEqual([]);
    expect(intoWindows()).toHaveLength(1);
    expect(intoWindows()[0]).toMatchObject({
      windowId: 2,
      activate: false,
      specs: [{ focused: false, tabs: [{ tabId: 't1' }, {}, {}] }],
    });
  });

  test('a folded window still takes it', async () => {
    await renderPane();
    fireEvent.click(
      within(block(2)).getByRole('button', { name: /^Collapse: / })
    );
    // PREMISE: W2 folded, its row gone.
    expect(document.querySelector('[data-open-tab-id="21"]')).toBeNull();
    placeBlocks();
    block(2).getBoundingClientRect = () => box(204, ROW);
    carry(WINDOW, 10, 210);
    const r = receiver(10, 210);
    r.hover(10, 210);

    expect(lit()).toEqual(['2']);
    expect(r.take()).toBe(true);
    expect(intoWindows()[0]?.windowId).toBe(2);
  });

  describe('incognito, with Tab Keeper allowed there', () => {
    test('an incognito window is no target for a normal saved window: the box below lights, and a release opens a new window', async () => {
      await renderPane({ seed: seedWith(true, true) });
      placeBlocks();
      carry(WINDOW, 10, W2_Y);
      const r = receiver(10, W2_Y);

      r.hover(10, W2_Y);
      expect(lit()).toEqual([]);
      expect(lastBox()?.hasAttribute('data-landing')).toBe(true);
      // CONTROL: the normal window beside it takes it.
      r.hover(10, W1_Y);
      expect(lit()).toEqual(['1']);

      r.hover(10, W2_Y);
      expect(r.take()).toBe(true);
      expect(intoWindows()).toEqual([]);
      expect(restores()).toHaveLength(1);
    });

    test('an incognito saved window: the incognito window takes it, the normal one does not', async () => {
      await renderPane({
        seed: seedWith(true, true),
        saved: { ...savedWindow(), incognito: true },
      });
      placeBlocks();
      carry(WINDOW, 10, W2_Y);
      const r = receiver(10, W2_Y);

      r.hover(10, W2_Y);
      expect(lit()).toEqual(['2']);
      r.hover(10, W1_Y);
      expect(lit()).toEqual([]);
      expect(lastBox()?.hasAttribute('data-landing')).toBe(true);
    });
  });

  // Today's rule first: not allowed, a window saved incognito opens normal.
  test('not allowed in incognito, a window saved incognito counts as normal: a normal window takes it', async () => {
    await renderPane({
      seed: seedWith(false, false),
      saved: { ...savedWindow(), incognito: true },
    });
    placeBlocks();
    carry(WINDOW, 10, W1_Y);
    const r = receiver(10, W1_Y);

    r.hover(10, W1_Y);
    expect(lit()).toEqual(['1']);
  });

  // KAN-855 + R15. Lit, the box below pins over the list's bottom: there its
  // box wins over the window drawn beneath it. Here pinned at y 240..280, over W2.
  describe('the New window box pinned over a window', () => {
    const PINNED_Y = 260;
    // Carried in from the saved side, so the box is drawn (and given its box)
    // before the pane hears its first move.
    const carryIn = (y: number) => {
      carry(WINDOW, -50, y);
      act(() => moveCarry(10, y));
    };
    const pinAt = () => {
      const el = lastBox();
      if (!(el instanceof HTMLElement)) throw new Error('no box below');
      el.getBoundingClientRect = () => box(240, 40);
    };

    test('lit from the header, the pointer onto it keeps it lit and lights no window; a release opens a new window', async () => {
      await renderPane();
      placeBlocks();
      carryIn(HEADER_Y);
      pinAt();
      const r = receiver(10, HEADER_Y);
      r.hover(10, HEADER_Y);
      expect(lastBox()?.hasAttribute('data-landing')).toBe(true);

      r.hover(10, PINNED_Y);
      expect(lastBox()?.hasAttribute('data-landing')).toBe(true);
      expect(lit()).toEqual([]);

      expect(r.take()).toBe(true);
      expect(intoWindows()).toEqual([]);
      expect(restores()).toHaveLength(1);
    });

    test('carried straight onto it, unlit till then: it lights and the window beneath does not', async () => {
      await renderPane();
      placeBlocks();
      carryIn(PINNED_Y);
      pinAt();
      // PREMISE: unlit until the pointer is on it.
      expect(lastBox()?.hasAttribute('data-landing')).toBe(false);
      const r = receiver(10, PINNED_Y);

      r.hover(10, PINNED_Y);
      expect(lastBox()?.hasAttribute('data-landing')).toBe(true);
      expect(lit()).toEqual([]);
    });

    test('off it over a window, the window lights and it goes unlit; back on it, it lights again', async () => {
      await renderPane();
      placeBlocks();
      carryIn(HEADER_Y);
      pinAt();
      const r = receiver(10, HEADER_Y);
      r.hover(10, PINNED_Y);

      r.hover(10, W2_Y);
      expect(lit()).toEqual(['2']);
      expect(lastBox()?.hasAttribute('data-landing')).toBe(false);
      r.hover(10, PINNED_Y);
      expect(lit()).toEqual([]);
      expect(lastBox()?.hasAttribute('data-landing')).toBe(true);
    });

    test('its box is read once, and again only after the list scrolls', async () => {
      await renderPane();
      placeBlocks();
      carryIn(HEADER_Y);
      pinAt();
      const el = lastBox();
      if (!(el instanceof HTMLElement)) throw new Error('no box below');
      let reads = 0;
      const pinned = el.getBoundingClientRect;
      el.getBoundingClientRect = () => {
        reads += 1;
        return pinned();
      };
      const r = receiver(10, HEADER_Y);

      for (const y of [HEADER_Y, PINNED_Y, PINNED_Y + 5, HEADER_Y, PINNED_Y])
        r.hover(10, y);
      expect(reads).toBe(1);

      find('[data-open-now-scroller]').scrollTop = 40;
      r.hover(10, PINNED_Y);
      r.hover(10, PINNED_Y);
      expect(reads).toBe(2);
      find('[data-open-now-scroller]').scrollTop = 0;
    });

    // jsdom resolves the emotion stylesheet, so these are the rules drawn.
    test('a window carry draws it pinned, dashed and named while unlit; a tab carry keeps it a blank row', async () => {
      await renderPane();
      carryIn(W1_Y);
      const el = lastBox();
      if (!(el instanceof HTMLElement)) throw new Error('no box below');
      const label = el.querySelector('[data-drop-label]');
      if (!(label instanceof HTMLElement)) throw new Error('no label');
      expect(el.hasAttribute('data-landing')).toBe(false);
      expect(getComputedStyle(el).position).toBe('sticky');
      expect(getComputedStyle(el).borderTopStyle).toBe('dashed');
      expect(getComputedStyle(el).borderTopColor).not.toBe('rgba(0, 0, 0, 0)');
      expect(getComputedStyle(label).display).toBe('flex');

      // CONTROL: a tab carry's box, unlit, is today's blank row.
      act(() => endCarry('cancelled'));
      carry(tabOf(), -50, W1_Y);
      act(() => moveCarry(10, W1_Y));
      const tabBox = lastBox();
      if (!(tabBox instanceof HTMLElement)) throw new Error('no box below');
      const tabLabel = tabBox.querySelector('[data-drop-label]');
      if (!(tabLabel instanceof HTMLElement)) throw new Error('no label');
      expect(getComputedStyle(tabBox).position).not.toBe('sticky');
      expect(getComputedStyle(tabBox).borderTopColor).toBe('rgba(0, 0, 0, 0)');
      expect(getComputedStyle(tabLabel).display).toBe('none');
    });
  });

  test('nothing lit after the carry ends', async () => {
    await renderPane();
    placeBlocks();
    carry(WINDOW, 10, W1_Y);
    receiver(10, W1_Y).hover(10, W1_Y);
    act(() => endCarry('cancelled'));
    expect(lit()).toEqual([]);
  });
});
