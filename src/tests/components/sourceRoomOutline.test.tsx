import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';

import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import { CarryLayer } from '../../components/home/CarryLayer';
import { setDragging } from '../../components/home/rightpane/rowDrag/dropRules';
import { endCarry, startCarry } from '../../redux/carry';
import { beginDragHold, endDragHold } from '../../redux/dragHold';
import {
  saveToTabContainerInternal,
  selectTabContainer,
  type CarriedRef,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  setHasTabGroupsPermission,
  setIsNotDirty,
} from '../../redux/slices/globalStateSlice';
import { NEW_LAST_WINDOW } from '../../components/home/rightpane/newWindowTarget';
import { renderWithProviders } from '../setup/renderWithProviders';
import { standInSessionList } from '../setup/standInSessionList';
import {
  T0,
  group,
  s1,
  s2,
  s3,
  session,
  tab,
  tabIds,
  win,
  windowIn,
} from '../fixtures/sessionMoveFixture';

// KAN-354 C3 A. A drag into ANOTHER window of the same session leaves room
// at the BOTTOM of the window it left: previewShiftsAcross closes the source
// up below the row, and KAN-184 keeps the source's box until the release. A
// faint dotted outline is drawn there, one row tall -- the held row's own
// box -- so "this window is one row shorter now" can be seen while the row
// itself is drawn by the card at the pointer.
//
// Never for a landing in the row's own window, a refused one, or an adopted
// carry (whose source is the trailing block it rests in, gone after the
// drop).
//
// jsdom has no layout, and applies no transform. Every box the engine reads
// is given one below, in the pane's content space; a window block the
// preview moved reports its moved box, as a real rect does. Where an element
// is DRAWN is worked out here as its layout top plus every translateY on the
// way up -- what a browser would do with the same transforms.

const PANE_W = 400;
const X = 100;

type Table = Record<string, [top: number, height: number]>;
let table: Table = {};
let pane: HTMLElement | null = null;

function keyOf(el: Element): string | undefined {
  if (!(el instanceof HTMLElement)) return undefined;
  const d = el.dataset;
  if (d.dragRowId !== undefined) return `row:${d.dragRowId}`;
  if (d.dropWindowId !== undefined) return `win:${d.dropWindowId}`;
  if (d.fixedRowId !== undefined) return `fixed:${d.fixedRowId}`;
  if (d.bandId !== undefined) return `band:${d.bandId}`;
  if (d.newWindowTarget === 'first') return 'header:new-window';
  return undefined;
}

function rectOf(el: Element): DOMRect {
  if (el === pane) {
    return DOMRect.fromRect({ x: 0, y: 0, width: PANE_W, height: 500 });
  }
  const key = keyOf(el);
  const entry = key === undefined ? undefined : table[key];
  if (entry === undefined) return DOMRect.fromRect({});
  const [top, height] = entry;
  const shift =
    el instanceof HTMLElement
      ? parseFloat(el.dataset.windowShift ?? '') || 0
      : 0;
  return DOMRect.fromRect({ x: 0, y: top + shift, width: PANE_W, height });
}

// SR, the session on screen: w1 holds a loose tab, the two-member group ga,
// and a loose tab; w2 two loose tabs.
const SR = () =>
  session('SR', 'Room', T0, [
    win(
      'w1',
      [tab('a0'), tab('x0', 'ga'), tab('x1', 'ga'), tab('a1')],
      [group('ga')]
    ),
    win('w2', [tab('b0'), tab('b1')]),
  ]);

// The tab list as drawn, every window open:
//
//   w1 0..192: header 0..32, a0 32..64, band ga 64..160 (title 64..96,
//              x0 96..128, x1 128..160), a1 160..192
//   w2 200..296: header 200..232, b0 232..264, b1 264..296
const TAB_LAYOUT: Table = {
  'win:w1': [0, 192],
  'row:tab:a0': [32, 32],
  'row:a0': [32, 32],
  'row:group:ga': [64, 96],
  'band:ga': [64, 96],
  'fixed:ga': [64, 32],
  'row:x0': [96, 32],
  'row:x1': [128, 32],
  'fixed:ga:tail': [160, 0],
  'row:tab:a1': [160, 32],
  'row:a1': [160, 32],
  'win:w2': [200, 96],
  'row:tab:b0': [232, 32],
  'row:b0': [232, 32],
  'row:tab:b1': [264, 32],
  'row:b1': [264, 32],
};

// The items list while ga is held: the held group compressed to its title
// row (KAN-160), which is the layout its drag measures.
//
//   w1 0..128: header 0..32, a0 32..64, ga 64..96, a1 96..128
//   w2 136..232: header 136..168, b0 168..200, b1 200..232
const GROUP_LAYOUT: Table = {
  'win:w1': [0, 128],
  'row:tab:a0': [32, 32],
  'row:group:ga': [64, 32],
  'row:tab:a1': [96, 32],
  'win:w2': [136, 96],
  'row:tab:b0': [168, 32],
  'row:tab:b1': [200, 32],
};

let unregisterList = () => {};
beforeEach(() => {
  unregisterList = standInSessionList({
    left: -400,
    right: 0,
    top: 0,
    bottom: 500,
  }).unregister;
  table = {};
  pane = null;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: Element) {
      return rectOf(this);
    }
  );
});

afterEach(() => {
  unregisterList();
  act(() => endCarry('cancelled'));
  endDragHold();
  document.documentElement.removeAttribute('data-dragging');
  vi.restoreAllMocks();
});

async function renderDetail(shown: string) {
  const result = await renderWithProviders(
    <>
      <TabGroupDetailsContainer />
      <CarryLayer />
    </>,
    {
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(true));
        store.dispatch(saveToTabContainerInternal(s3()));
        store.dispatch(saveToTabContainerInternal(s2()));
        store.dispatch(saveToTabContainerInternal(s1()));
        store.dispatch(saveToTabContainerInternal(SR()));
        store.dispatch(selectTabContainer(shown));
        store.dispatch(setIsNotDirty());
      },
    }
  );
  const el = result.container.firstElementChild;
  if (!(el instanceof HTMLElement)) throw new Error('no detail pane');
  el.style.overflowY = 'auto';
  pane = el;
  return result;
}

function find(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (el === null) throw new Error(`nothing matches ${selector}`);
  return el;
}
const row = (id: string) => find(`[data-drag-row-id="${id}"]`);
const block = (windowId: string) => find(`[data-drop-window-id="${windowId}"]`);
const outlines = () => document.querySelectorAll('[data-drag-source-room]');
const outlineOf = (held: HTMLElement): HTMLElement => {
  const el = held.querySelector(':scope > [data-drag-source-room]');
  if (!(el instanceof HTMLElement)) throw new Error('no source-room outline');
  return el;
};
const slotOf = (held: HTMLElement): HTMLElement => {
  const el = held.querySelector(':scope > [data-drag-landing-slot]');
  if (!(el instanceof HTMLElement)) throw new Error('no landing slot');
  return el;
};

const translateOf = (el: Element): number =>
  el instanceof HTMLElement
    ? Number(/translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0)
    : 0;

// Where `el` is drawn, top edge: `layoutTop` -- the top of the box it is
// laid out at, before any transform -- plus every translateY from it up to
// the page, as a browser composes them.
const drawnTop = (el: Element, layoutTop: number): number => {
  let y = layoutTop;
  for (let e: Element | null = el; e !== null; e = e.parentElement) {
    y += translateOf(e);
  }
  return y;
};

// Whether anything between the element and the page hides it. Opacity does
// not inherit in a computed style, so the element's own is not enough.
const seen = (el: Element) => {
  for (let e: Element | null = el; e !== null; e = e.parentElement) {
    const style = getComputedStyle(e);
    if (style.opacity === '0' || style.visibility === 'hidden') return false;
  }
  return true;
};

const layoutTopOf = (key: string): number => {
  const entry = table[key];
  if (entry === undefined) throw new Error(`no layout for ${key}`);
  return entry[0];
};

const moveTo = (y: number, x = X) =>
  act(() => {
    fireEvent.pointerMove(document, { clientX: x, clientY: y });
  });
const release = (y: number, x = X) =>
  act(() => {
    fireEvent.pointerUp(document, { clientX: x, clientY: y });
  });

// Presses the tab `id` at its middle and drags it 8px down: a started drag,
// still over its own place.
function pickUpTab(id: string, layout: Table = TAB_LAYOUT): HTMLElement {
  table = layout;
  const y = layoutTopOf(`row:${id}`) + 16;
  fireEvent.pointerDown(row(id), { clientX: X, clientY: y, button: 0 });
  moveTo(y + 8);
  return row(id);
}

function pickUpGroup(id: string): HTMLElement {
  table = GROUP_LAYOUT;
  const handle = row(`group:${id}`).querySelector('[data-group-drag-handle]');
  if (!(handle instanceof HTMLElement)) throw new Error('no group handle');
  const y = layoutTopOf(`row:group:${id}`) + 16;
  fireEvent.pointerDown(handle, { clientX: X, clientY: y, button: 0 });
  moveTo(y + 8);
  return row(`group:${id}`);
}

describe('the outline over the room a row leaves (KAN-354 C3 A)', () => {
  test('a tab from w1 into w2: at the bottom of w1, one row tall', async () => {
    await renderDetail('SR');
    const held = pickUpTab('a0');
    // PREMISE: picked up as a card, and nothing is outlined in its own window.
    expect(held.hasAttribute('data-held-as-card')).toBe(true);
    expect(outlines()).toHaveLength(0);

    // Into w2, between b0 and b1.
    moveTo(267);

    // PREMISE: the landing is in w2 -- b1 steps down, w1 closes up under a0.
    expect(translateOf(row('b1'))).toBe(32);
    expect(translateOf(row('a1'))).toBe(-32);
    expect(outlines()).toHaveLength(1);
    const outline = outlineOf(held);
    // w1's last slot ends at 192 and a0's own box at 64: the room is 128
    // below a0's place, and the outline counter-transforms out of the held
    // row's translate to sit there.
    const translate = translateOf(held);
    expect(translate).toBe(219);
    expect(outline.style.transform).toBe(`translateY(${128 - translate}px)`);
    // Drawn at 160..192: the bottom row of w1, where a1 stood.
    expect(drawnTop(outline, layoutTopOf('row:a0'))).toBe(160);

    // The held row's own box, like the landing slot.
    expect(outline.getAttribute('aria-hidden')).toBe('true');
    expect(outline.style.position).toBe('absolute');
    expect(outline.style.top).toBe('0px');
    expect(outline.style.bottom).toBe('0px');
    expect(outline.style.left).toBe('0px');
    expect(outline.style.right).toBe('0px');
    expect(outline.style.borderStyle).toBe('dotted');
    expect(outline.style.borderWidth).toBe('1.5px');
    expect(outline.style.borderRadius).toBe('4px');
    expect(outline.style.opacity).toBe('0.45');
    expect(outline.style.pointerEvents).toBe('none');
    // Seen. Not because HELD_AS_CARD_STYLE leaves it out: its own inline
    // opacity outranks that rule's `opacity: 0` on the row's children, so
    // this holds with or without the exclusion (verified: removing it
    // fails nothing here or in the e2e).
    expect(seen(outline)).toBe(true);

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(outlines()).toHaveLength(0);
    release(267);
  });

  test('the held row last in its window: the outline is its own place', async () => {
    await renderDetail('SR');
    const held = pickUpTab('a1');

    moveTo(267);

    // PREMISE: the landing is in w2.
    expect(translateOf(row('b1'))).toBe(32);
    const outline = outlineOf(held);
    expect(outline.style.transform).toBe(`translateY(${-translateOf(held)}px)`);
    expect(drawnTop(outline, layoutTopOf('row:a1'))).toBe(160);
    release(267);
  });

  // Review Focus 4. Upward, the source is BELOW the destination, so it is
  // the source's block the preview moves down to make room (KAN-184): the
  // room is at the MOVED block's bottom. The probe on main: Maps from w2
  // into w1 left w2's room at 424..456, 32 below where w2 had ended.
  test('upward, a tab from w2 into w1: at the bottom of the moved w2', async () => {
    await renderDetail('SR');
    const held = pickUpTab('b0');

    // Into w1, above a0.
    moveTo(35);

    // PREMISE: the landing is in w1, so w2's block moves down a row.
    expect(translateOf(block('w2'))).toBe(32);
    expect(translateOf(row('a0'))).toBe(32);
    const outline = outlineOf(held);
    // b0 ends at 264 and w2's last slot at 296.
    expect(outline.style.transform).toBe(
      `translateY(${32 - translateOf(held)}px)`
    );
    const movedBottom = layoutTopOf('win:w2') + 96 + translateOf(block('w2'));
    expect(movedBottom).toBe(328);
    expect(drawnTop(outline, layoutTopOf('row:b0'))).toBe(movedBottom - 32);
    release(35);
  });

  // Q3. A group carried into another window leaves a row's room too: its
  // compressed box (KAN-160), at the bottom of the window it left.
  test('a group from w1 into w2: the group’s compressed box, at the bottom of w1', async () => {
    await renderDetail('SR');
    const held = pickUpGroup('ga');
    expect(held.hasAttribute('data-held-as-card')).toBe(true);

    // Into w2, between b0 and b1.
    moveTo(203);

    // PREMISE: the landing is in w2. By the group's footprint, 34: its band
    // keeps a 2px margin below it.
    expect(translateOf(row('tab:b1'))).toBe(34);
    expect(translateOf(row('tab:a1'))).toBe(-34);
    const outline = outlineOf(held);
    // ga's compressed box ends at 96, w1's last slot at 128.
    expect(outline.style.transform).toBe(
      `translateY(${32 - translateOf(held)}px)`
    );
    expect(drawnTop(outline, layoutTopOf('row:group:ga'))).toBe(96);
    // The held row's own box: whatever it is drawn at, compressed.
    expect(outline.style.top).toBe('0px');
    expect(outline.style.bottom).toBe('0px');
    expect(seen(outline)).toBe(true);
    release(203);
  });
});

describe('no outline where no room is left in another window', () => {
  // Aimed where the outline would sit: the bottom of w1, a1's place. A row
  // landing in its own window closes the room up itself, and its landing
  // slot is the one thing drawn.
  test('back into its own window, at the bottom of it', async () => {
    const { store } = await renderDetail('SR');
    const held = pickUpTab('a0');
    moveTo(267);
    // PREMISE: drawn while the landing is in w2.
    expect(outlines()).toHaveLength(1);

    moveTo(185);

    // PREMISE: the landing is in w1 again, after a1: nothing in w2 moves.
    expect(translateOf(row('b1'))).toBe(0);
    expect(translateOf(row('a1'))).toBe(-32);
    expect(slotOf(held)).toBeInstanceOf(HTMLElement);
    expect(outlines()).toHaveLength(0);

    release(185);
    // PREMISE: it landed in w1, last.
    expect(
      tabIds(windowIn(store.getState().tabContainerDataState, 'SR', 'w1'))
    ).toEqual(['x0', 'x1', 'a1', 'a0']);
  });

  test('a refused release point, outside every window', async () => {
    const { store } = await renderDetail('SR');
    const before = store.getState().tabContainerDataState;
    const held = pickUpTab('a0');
    moveTo(267);
    // PREMISE: drawn while the landing is in w2.
    expect(outlines()).toHaveLength(1);

    // Below every window and outside the pane.
    moveTo(600);

    // PREMISE: still a drag, so the outline went because the landing was
    // refused, not because the drag ended.
    expect(held.hasAttribute('data-drag-held')).toBe(true);
    expect(outlines()).toHaveLength(0);
    release(600);
    // PREMISE: refused, not committed.
    expect(store.getState().tabContainerDataState).toBe(before);
  });
});

// An adopted carry's source is the trailing block its phantom rests in
// (KAN-361/366), which holds nothing after the drop: "this window is one row
// shorter" would be false.
describe('no outline for an adopted carry', () => {
  // S2 while a TAB is carried: d1 and d2 as drawn, then the trailing block
  // holding the phantom (openedSessionTakesCarry.test.tsx's).
  const S2_TAB_LAYOUT: Table = {
    'win:d1': [0, 176],
    'row:tab:u1': [32, 32],
    'row:u1': [32, 32],
    'row:group:h1': [64, 96],
    'band:h1': [64, 96],
    'fixed:h1': [64, 32],
    'row:u2': [96, 32],
    'row:u3': [128, 32],
    'fixed:h1:tail': [160, 0],
    'win:d2': [184, 64],
    'row:tab:u4': [216, 32],
    'row:u4': [216, 32],
    [`win:${NEW_LAST_WINDOW}`]: [256, 40],
    'row:tab:carried:t1': [260, 32],
    'row:carried:t1': [260, 32],
  };
  const T1: CarriedRef = {
    kind: 'tab',
    tabGroupId: 'S1',
    windowId: 'w1',
    tabId: 't1',
  };

  test('the phantom moved into a second window draws none', async () => {
    await renderDetail('S2');
    // As the engine leaves things at the hand-off.
    setDragging(true, 'tab');
    beginDragHold();
    act(() =>
      startCarry(T1, { kind: 'tab', title: 't1', faviconUrl: '' }, -40, 100)
    );
    table = S2_TAB_LAYOUT;

    // Into the pane over d1's first row: adopted, and landing in d1.
    moveTo(36);

    // PREMISE: the adopted phantom is held, drawn by the carry's card, and
    // its landing is in another window than the one it sits in -- d1's rows
    // make room and d2 moves down.
    const held = row('carried:t1');
    expect(held.hasAttribute('data-drag-held')).toBe(true);
    expect(held.hasAttribute('data-held-as-card')).toBe(true);
    expect(translateOf(row('u1'))).toBe(32);
    expect(translateOf(block('d2'))).toBe(32);
    expect(outlines()).toHaveLength(0);
  });
});

// KAN-361 (N1 B, Q2 ii). The session header's New window target is a
// landing outside the list: a new first window. While it is the landing the
// row's own window closes up behind it with its room outlined at its bottom,
// exactly as for a drop into another window -- and nothing else moves, since
// there is no destination in the list to make room in. No slot is drawn:
// the lit target shows where the row goes.
describe('on the header’s New window target (KAN-361, Q2 ii)', () => {
  // Above the pane, as the toolbar row is: 0..400 across, -40..-8 down.
  const HEADER_Y = -24;
  let header: HTMLElement;
  beforeEach(() => {
    header = document.createElement('div');
    header.dataset.newWindowTarget = 'first';
    document.body.append(header);
  });
  afterEach(() => {
    header.remove();
    document.documentElement.removeAttribute('data-drag-new-window');
  });
  const WITH_HEADER: Table = {
    ...TAB_LAYOUT,
    'header:new-window': [-40, 32],
  };

  test('a tab held there: its window closes up, its room outlined at that window’s bottom; nothing else moves, no slot, the target lit', async () => {
    const { store } = await renderDetail('SR');
    const held = pickUpTab('a0', WITH_HEADER);

    moveTo(HEADER_Y);

    expect(header.hasAttribute('data-landing')).toBe(true);
    expect(held.querySelector(':scope > [data-drag-landing-slot]')).toBe(null);
    // w1 closes up under a0's place.
    for (const id of ['x0', 'x1', 'a1']) {
      expect(translateOf(row(id))).toBe(-32);
    }
    // Nothing else moves: not w2, not its rows.
    expect(block('w2').dataset.windowShift ?? '0').toBe('0');
    expect(translateOf(row('b0'))).toBe(0);
    expect(translateOf(row('b1'))).toBe(0);
    // The room, outlined at w1's bottom: 160..192, where a1 stood.
    expect(outlines()).toHaveLength(1);
    expect(drawnTop(outlineOf(held), layoutTopOf('row:a0'))).toBe(160);

    release(HEADER_Y);
    const data = store.getState().tabContainerDataState;
    const sr = data.tabGroups.find((g) => g.tabGroupId === 'SR');
    expect(sr?.windows.map(tabIds)).toEqual([
      ['a0'],
      ['x0', 'x1', 'a1'],
      ['b0', 'b1'],
    ]);
    expect(header.hasAttribute('data-landing')).toBe(false);
  });

  // The header's target is outside the list and outlives it. A list that
  // goes away mid-drag (a sync taking the shown session) must not leave it
  // lit: the next carry would show it lit with the pointer elsewhere.
  test('the list unmounting mid-drag unlights the target it lit', async () => {
    const { unmount } = await renderDetail('SR');
    pickUpTab('a0', WITH_HEADER);
    moveTo(HEADER_Y);
    // PREMISE: lit by this drag.
    expect(header.hasAttribute('data-landing')).toBe(true);

    act(() => unmount());

    // PREMISE: the target outlived the list.
    expect(header.isConnected).toBe(true);
    expect(header.hasAttribute('data-landing')).toBe(false);
  });

  // A list scrolled down can leave a band of the held row's window above
  // the pane, behind the header, where a viewport hit test still finds it.
  // A new window holds no band: none is marked, and none is joined.
  test('a band behind the header is not the target', async () => {
    const { store } = await renderDetail('SR');
    pickUpTab('a0', WITH_HEADER);
    // ga, scrolled up behind the target.
    table = { ...WITH_HEADER, 'band:ga': [-48, 96] };

    moveTo(HEADER_Y);

    expect(header.hasAttribute('data-landing')).toBe(true);
    expect(document.querySelectorAll('[data-drop-target]')).toHaveLength(0);
    release(HEADER_Y);
    const first = store
      .getState()
      .tabContainerDataState.tabGroups.find((g) => g.tabGroupId === 'SR')
      ?.windows[0];
    expect(first?.tabs.map((t) => [t.tabId, t.chromeGroupId])).toEqual([
      ['a0', undefined],
    ]);
  });
});

// KAN-366 B. Below the last window is the list's trailing block: a new LAST
// window. While it is the landing the row's own window closes up behind it
// with its room outlined at its bottom (Q2 ii), nothing else moves, no slot
// is drawn, and the block is lit. A row of the last window keeps its
// overshoot slack there: within half its height of that window's last row
// it lands last in its own window, as before the block existed.
describe('below the last window (KAN-366 B)', () => {
  // The trailing block, zero height, 8px under w2 (296), as a list that
  // fits draws it.
  const WITH_TRAILING: Table = {
    ...TAB_LAYOUT,
    [`win:${NEW_LAST_WINDOW}`]: [304, 0],
  };
  const trailing = () => block(NEW_LAST_WINDOW);
  const windowsOf = (
    store: Awaited<ReturnType<typeof renderDetail>>['store']
  ) =>
    store
      .getState()
      .tabContainerDataState.tabGroups.find((g) => g.tabGroupId === 'SR')
      ?.windows.map(tabIds);

  test('a tab from w1 held there: lit, its window closes up with its room outlined, nothing else moves, no slot; let go, a new last window', async () => {
    const { store } = await renderDetail('SR');
    const held = pickUpTab('a0', WITH_TRAILING);

    moveTo(400);

    expect(trailing().hasAttribute('data-landing')).toBe(true);
    expect(held.querySelector(':scope > [data-drag-landing-slot]')).toBe(null);
    for (const id of ['x0', 'x1', 'a1']) {
      expect(translateOf(row(id))).toBe(-32);
    }
    expect(block('w2').dataset.windowShift ?? '0').toBe('0');
    expect(translateOf(row('b0'))).toBe(0);
    expect(translateOf(row('b1'))).toBe(0);
    expect(outlines()).toHaveLength(1);
    expect(drawnTop(outlineOf(held), layoutTopOf('row:a0'))).toBe(160);

    release(400);
    expect(windowsOf(store)).toEqual([
      ['x0', 'x1', 'a1'],
      ['b0', 'b1'],
      ['a0'],
    ]);
    expect(trailing().hasAttribute('data-landing')).toBe(false);
  });

  // Both sides of the slack's edge: w2's last row ends at 296, and the held
  // row is 32 tall, so the slack ends at 312. Both points are at or below
  // the trailing block's top (304).
  test.each([
    ['inside its slack, at 306', 306, false, [['b1', 'b0']]],
    ['just past its slack, at 314', 314, true, [['b1'], ['b0']]],
  ])('b0, of the last window, %s', async (_where, y, lit, last) => {
    const { store } = await renderDetail('SR');
    pickUpTab('b0', WITH_TRAILING);

    moveTo(y);

    expect(trailing().hasAttribute('data-landing')).toBe(lit);
    release(y);
    expect(windowsOf(store)?.slice(1)).toEqual(last);
  });

  test('a1, of another window, at the same point inside w2’s slack: a new last window', async () => {
    const { store } = await renderDetail('SR');
    pickUpTab('a1', WITH_TRAILING);

    moveTo(306);

    expect(trailing().hasAttribute('data-landing')).toBe(true);
    release(306);
    expect(windowsOf(store)).toEqual([
      ['a0', 'x0', 'x1'],
      ['b0', 'b1'],
      ['a1'],
    ]);
  });

  // The gap between the last window and the block is still below the last
  // window: refused for a row of another window, as before the block.
  test('in the gap above the block, a1 is refused', async () => {
    const { store } = await renderDetail('SR');
    const before = windowsOf(store);
    pickUpTab('a1', WITH_TRAILING);

    moveTo(300);

    expect(trailing().hasAttribute('data-landing')).toBe(false);
    release(300);
    expect(windowsOf(store)).toEqual(before);
  });

  test('beside the pane, below the list: refused', async () => {
    const { store } = await renderDetail('SR');
    const before = windowsOf(store);
    pickUpTab('a1', WITH_TRAILING);
    // CONTROL: inside the pane at that height, lit.
    moveTo(400);
    expect(trailing().hasAttribute('data-landing')).toBe(true);

    moveTo(400, PANE_W + 30);

    expect(trailing().hasAttribute('data-landing')).toBe(false);
    release(400, PANE_W + 30);
    expect(windowsOf(store)).toEqual(before);
  });
});
