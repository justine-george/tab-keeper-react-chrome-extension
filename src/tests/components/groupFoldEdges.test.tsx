import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';

import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import { CarryLayer } from '../../components/home/CarryLayer';
import { endCarry } from '../../redux/carry';
import { endDragHold } from '../../redux/dragHold';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  setHasTabGroupsPermission,
  setIsNotDirty,
} from '../../redux/slices/globalStateSlice';
import { NEW_LAST_WINDOW } from '../../components/home/rightpane/newWindowTarget';
import type { tabContainerData } from '../../redux/slices/tabContainerDataStateSlice';
import { renderWithProviders } from '../setup/renderWithProviders';
import { standInSessionList } from '../setup/standInSessionList';
import { T0, group, session, tab, win } from '../fixtures/sessionMoveFixture';

// KAN-822 edge picks, on the saved tab list with real boxes (jsdom has none; each is given one below).
// 1B: the first half row below a group that ends the last window lands after it; New window starts below that.
// 2B: a lone tab's emptied group keeps its room until the pointer has passed the group right below it.

const PANE_W = 400;
const X = 100;
const ROW = 32;

type Table = Record<string, [top: number, height: number]>;
let table: Table = {};
let pane: HTMLElement | null = null;
// The pane's inner height, which what is free below the last window is measured against (KAN-944).
let paneInner = 500;

function keyOf(el: Element): string | undefined {
  if (!(el instanceof HTMLElement)) return undefined;
  const d = el.dataset;
  if (d.dragRowId !== undefined) return `row:${d.dragRowId}`;
  if (d.dropWindowId !== undefined) return `win:${d.dropWindowId}`;
  if (d.fixedRowId !== undefined) return `fixed:${d.fixedRowId}`;
  if (d.bandId !== undefined) return `band:${d.bandId}`;
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
  paneInner = 500;
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

async function renderSession(shown: tabContainerData, layout: Table) {
  table = layout;
  const result = await renderWithProviders(
    <>
      <TabGroupDetailsContainer />
      <CarryLayer />
    </>,
    {
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(true));
        store.dispatch(saveToTabContainerInternal(shown));
        store.dispatch(selectTabContainer(shown.tabGroupId));
        store.dispatch(setIsNotDirty());
      },
    }
  );
  const el = result.container.firstElementChild;
  if (!(el instanceof HTMLElement)) throw new Error('no detail pane');
  el.style.overflowY = 'auto';
  Object.defineProperty(el, 'clientHeight', {
    get: () => paneInner,
    configurable: true,
  });
  pane = el;
  // Each window as stored, a tab as id or id:group.
  const windows = () =>
    result.store
      .getState()
      .tabContainerDataState.tabGroups.find(
        (g) => g.tabGroupId === shown.tabGroupId
      )
      ?.windows.map((w) =>
        w.tabs.map((t) =>
          t.chromeGroupId === undefined
            ? t.tabId
            : `${t.tabId}:${t.chromeGroupId}`
        )
      );
  return { windows };
}

function find(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (el === null) throw new Error(`nothing matches ${selector}`);
  return el;
}
const row = (id: string) => find(`[data-drag-row-id="${id}"]`);
const band = (id: string) => find(`[data-band-id="${id}"][role="group"]`);
const titleOf = (id: string) => {
  const el = band(id).querySelector('[data-group-drag-handle]');
  if (!(el instanceof HTMLElement)) throw new Error(`no title row for ${id}`);
  return el;
};
const newWindowRoom = () => document.documentElement.dataset.dragNewWindow;
const trailingLit = () =>
  find(`[data-drop-window-id="${NEW_LAST_WINDOW}"]`).hasAttribute(
    'data-landing'
  );
const translateOf = (el: Element): number =>
  el instanceof HTMLElement
    ? Number(/translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0)
    : 0;
// Where the held row's landing slot is drawn: the held row's layout top plus every translateY up to the page.
const slotTop = (held: HTMLElement, layoutTop: number): number | null => {
  const slot = held.querySelector(':scope > [data-drag-landing-slot]');
  if (slot === null) return null;
  let y = layoutTop;
  for (let e: Element | null = slot; e !== null; e = e.parentElement) {
    y += translateOf(e);
  }
  return y;
};

const moveTo = (y: number) =>
  act(() => {
    fireEvent.pointerMove(document, { clientX: X, clientY: y });
  });
const release = (y: number) =>
  act(() => {
    fireEvent.pointerUp(document, { clientX: X, clientY: y });
  });

// Presses tab `id` at its middle and drags it 8px down: a started drag, still over its own place.
function pickUp(id: string): HTMLElement {
  const entry = table[`row:${id}`];
  if (entry === undefined) throw new Error(`no layout for ${id}`);
  const y = entry[0] + ROW / 2;
  fireEvent.pointerDown(row(id), { clientX: X, clientY: y, button: 0 });
  moveTo(y + 8);
  return row(id);
}

// Presses group `id`'s title row at its middle and drags it 8px down.
function pickUpGroup(id: string) {
  const handle = row(`group:${id}`).querySelector('[data-group-drag-handle]');
  if (!(handle instanceof HTMLElement)) throw new Error(`no handle for ${id}`);
  const entry = table[`row:group:${id}`];
  if (entry === undefined) throw new Error(`no layout for group ${id}`);
  const y = entry[0] + ROW / 2;
  fireEvent.pointerDown(handle, { clientX: X, clientY: y, button: 0 });
  moveTo(y + 8);
}

describe('below a group that ends the last window (pick 1B)', () => {
  // w1 0..96: a0 32..64, a1 64..96. w2 104..204: b0 136..168, folded gb 170..202. The trailing block at 212.
  const folded = (last: 'group' | 'row') =>
    session('SG', 'Edges', T0, [
      win('w1', [tab('a0'), tab('a1')]),
      win(
        'w2',
        [
          tab('b0'),
          tab('y0', 'gb'),
          tab('y1', 'gb'),
          ...(last === 'row' ? [tab('b1')] : []),
        ],
        [{ ...group('gb'), collapsed: true }]
      ),
    ]);
  const FOLDED: Table = {
    'win:w1': [0, 96],
    'row:a0': [32, ROW],
    'row:a1': [64, ROW],
    'win:w2': [104, 100],
    'row:b0': [136, ROW],
    'band:gb': [170, ROW],
    'fixed:gb': [170, ROW],
    [`win:${NEW_LAST_WINDOW}`]: [212, 0],
  };

  // Past w2's box (204), short of the band's bottom (202) plus half a row (218); then past that.
  test.each([
    [
      'b0, of the last window',
      'b0',
      [
        ['a0', 'a1'],
        ['y0:gb', 'y1:gb', 'b0'],
      ],
    ],
    ['a0, of another window', 'a0', [['a1'], ['b0', 'y0:gb', 'y1:gb', 'a0']]],
  ])(
    '%s, just under the folded group: lands after it, ungrouped',
    async (_who, id, after) => {
      const { windows } = await renderSession(folded('group'), FOLDED);
      pickUp(id);
      moveTo(216);
      expect(trailingLit()).toBe(false);
      release(216);
      expect(windows()).toEqual(after);
    }
  );

  test.each([
    ['b0', 'b0', ['y0:gb', 'y1:gb']],
    ['a0', 'a0', ['b0', 'y0:gb', 'y1:gb']],
  ])(
    '%s past half a row under it: a new last window',
    async (_who, id, left) => {
      const { windows } = await renderSession(folded('group'), FOLDED);
      pickUp(id);
      moveTo(220);
      expect(trailingLit()).toBe(true);
      release(220);
      expect(windows()?.[1]).toEqual(left);
      expect(windows()?.[2]).toEqual([id]);
    }
  );

  // CONTROL: a row ends w2 (b1 at 204..236, w2 to 238, trailing at 246), so nothing changes below it.
  test('a row after the group ends the window: right under the window, a new last window', async () => {
    const { windows } = await renderSession(folded('row'), {
      ...FOLDED,
      'win:w2': [104, 134],
      'row:b1': [204, ROW],
      [`win:${NEW_LAST_WINDOW}`]: [246, 0],
    });
    pickUp('a0');
    moveTo(240);
    expect(trailingLit()).toBe(true);
    release(240);
    expect(windows()?.[2]).toEqual(['a0']);
  });

  // R3. 1B takes 202 + 16 - 212 = 6px of the New window block, so 16 free plus 6 is the threshold for room.
  test.each([
    ['20px free: room, so New window keeps half a row', 212 + 20, 'room'],
    ['23px free: none needed', 212 + 23, ''],
  ])('a list that fits with %s', async (_what, inner, marker) => {
    paneInner = inner;
    const { windows } = await renderSession(folded('group'), FOLDED);
    pickUp('a0');
    expect(newWindowRoom()).toBe(marker);
    moveTo(219);
    expect(trailingLit()).toBe(true);
    release(219);
    expect(windows()?.[2]).toEqual(['a0']);
  });

  // R4. A group dragged there keeps the old rule: the whole space below the last window is New window.
  test('a group dragged just under the folded group that ends the last window: a new last window', async () => {
    const withGroup = session('SG', 'Edges', T0, [
      win('w1', [tab('a0'), tab('x0', 'ga')], [group('ga')]),
      win(
        'w2',
        [tab('b0'), tab('y0', 'gb'), tab('y1', 'gb')],
        [{ ...group('gb'), collapsed: true }]
      ),
    ]);
    const { windows } = await renderSession(withGroup, {
      // The items list, ga held folded to its title row (KAN-160).
      'win:w1': [0, 96],
      'row:tab:a0': [32, ROW],
      'row:group:ga': [64, ROW],
      'band:ga': [64, ROW],
      'fixed:ga': [64, ROW],
      'win:w2': [104, 100],
      'row:tab:b0': [136, ROW],
      'row:group:gb': [170, ROW],
      'band:gb': [170, ROW],
      'fixed:gb': [170, ROW],
      [`win:${NEW_LAST_WINDOW}`]: [212, 0],
    });
    pickUpGroup('ga');
    moveTo(216);
    expect(trailingLit()).toBe(true);
    release(216);
    expect(windows()).toEqual([['a0'], ['b0', 'y0:gb', 'y1:gb'], ['x0:ga']]);
  });

  // Minor 1. s0 leaves gs and a loose a1 follows it, so gs closes up (KAN-916) and gf is drawn 40px higher:
  // its half row ends at 204 - 40 + 16 = 180, inside w1's box, and right under w1 is New window.
  test('below a group drawn closed up: the half row follows where it is drawn', async () => {
    const closing = session('SC', 'Edges', T0, [
      win(
        'w1',
        [
          tab('a0'),
          tab('s0', 'gs'),
          tab('a1'),
          tab('f0', 'gf'),
          tab('f1', 'gf'),
        ],
        [group('gs'), { ...group('gf'), collapsed: true }]
      ),
    ]);
    const { windows } = await renderSession(closing, {
      'win:w1': [0, 206],
      'row:a0': [32, ROW],
      'band:gs': [68, 64],
      'fixed:gs': [68, ROW],
      'row:s0': [100, ROW],
      'fixed:gs:tail': [132, 0],
      'row:a1': [136, ROW],
      'band:gf': [172, ROW],
      'fixed:gf': [172, ROW],
      [`win:${NEW_LAST_WINDOW}`]: [214, 0],
    });
    pickUp('s0');
    moveTo(208);
    expect(trailingLit()).toBe(true);
    release(208);
    expect(windows()).toEqual([['a0', 'a1', 'f0:gf', 'f1:gf'], ['s0']]);
  });

  // An open gb: title 170..202, y0 202..234, y1 234..266; w2 to 268, trailing at 276.
  const open = () =>
    session('SO', 'Edges', T0, [
      win('w1', [tab('a0'), tab('a1')]),
      win('w2', [tab('b0'), tab('y0', 'gb'), tab('y1', 'gb')], [group('gb')]),
    ]);
  const OPEN: Table = {
    'win:w1': [0, 96],
    'row:a0': [32, ROW],
    'row:a1': [64, ROW],
    'win:w2': [104, 164],
    'row:b0': [136, ROW],
    'band:gb': [170, 96],
    'fixed:gb': [170, ROW],
    'row:y0': [202, ROW],
    'row:y1': [234, ROW],
    'fixed:gb:tail': [266, 0],
    [`win:${NEW_LAST_WINDOW}`]: [276, 0],
  };

  test('a0, of another window, just under the open group: lands after it, ungrouped', async () => {
    const { windows } = await renderSession(open(), OPEN);
    pickUp('a0');
    moveTo(280);
    expect(trailingLit()).toBe(false);
    release(280);
    expect(windows()).toEqual([['a1'], ['b0', 'y0:gb', 'y1:gb', 'a0']]);
  });

  test('a0 past half a row under the open group: a new last window', async () => {
    const { windows } = await renderSession(open(), OPEN);
    pickUp('a0');
    moveTo(284);
    expect(trailingLit()).toBe(true);
    release(284);
    expect(windows()?.[2]).toEqual(['a0']);
  });
});

describe("a lone tab's emptied group holds its room while the drop stays in its window (pick 2B, R1)", () => {
  // w1: a0 32..64, gs 68..132 (title 68..100, s0 100..132), then gf at 140, then a1.
  const lone = (foldedBelow: boolean, next: tabContainerData['windows'] = []) =>
    session('SL', 'Lone', T0, [
      win(
        'w1',
        [
          tab('a0'),
          tab('s0', 'gs'),
          tab('f0', 'gf'),
          tab('f1', 'gf'),
          tab('a1'),
        ],
        [
          group('gs'),
          { ...group('gf'), ...(foldedBelow ? { collapsed: true } : {}) },
        ]
      ),
      ...next,
    ]);
  const ABOVE: Table = {
    'row:a0': [32, ROW],
    'band:gs': [68, 64],
    'fixed:gs': [68, ROW],
    'row:s0': [100, ROW],
    'fixed:gs:tail': [132, 0],
  };
  // gf folded to its title, 140..172; a1 176..208.
  const FOLDED: Table = {
    ...ABOVE,
    'win:w1': [0, 212],
    'band:gf': [140, ROW],
    'fixed:gf': [140, ROW],
    'row:a1': [176, ROW],
    [`win:${NEW_LAST_WINDOW}`]: [220, 0],
  };
  // gf open: title 140..172, f0 172..204, f1 204..236; a1 240..272.
  const OPEN: Table = {
    ...ABOVE,
    'win:w1': [0, 276],
    'band:gf': [140, 96],
    'fixed:gf': [140, ROW],
    'row:f0': [172, ROW],
    'row:f1': [204, ROW],
    'fixed:gf:tail': [236, 0],
    'row:a1': [240, ROW],
    [`win:${NEW_LAST_WINDOW}`]: [284, 0],
  };

  test('on the folded group’s title row: the join wash, nothing below moves, no slot; let go, it joins', async () => {
    const { windows } = await renderSession(lone(true), FOLDED);
    const held = pickUp('s0');
    moveTo(150);
    expect(band('gf').hasAttribute('data-drop-target')).toBe(true);
    expect(translateOf(titleOf('gf'))).toBe(0);
    expect(translateOf(row('a1'))).toBe(0);
    expect(slotTop(held, 100)).toBeNull();
    release(150);
    expect(windows()).toEqual([['a0', 'f0:gf', 'f1:gf', 's0:gf', 'a1']]);
  });

  test('between the two groups: the folded one holds still, and the tab lands before it, ungrouped', async () => {
    const { windows } = await renderSession(lone(true), FOLDED);
    const held = pickUp('s0');
    moveTo(136);
    expect(band('gf').hasAttribute('data-drop-target')).toBe(false);
    expect(translateOf(titleOf('gf'))).toBe(0);
    expect(translateOf(row('a1'))).toBe(0);
    // Minor 2. Its own room, as with an open group below.
    expect(slotTop(held, 100)).toBe(100);
    release(136);
    expect(windows()).toEqual([['a0', 's0', 'f0:gf', 'f1:gf', 'a1']]);
  });

  // R1. Past the folded group, still in the window: nothing closes up, and loose after it lands there.
  test('past the folded group: it holds still, and the tab lands loose after it', async () => {
    const { windows } = await renderSession(lone(true), FOLDED);
    const held = pickUp('s0');
    moveTo(180);
    expect(translateOf(titleOf('gf'))).toBe(0);
    expect(translateOf(row('a1'))).toBe(ROW);
    // Under gf's title, past a band margin (KAN-167).
    expect(slotTop(held, 100)).toBe(174);
    release(180);
    expect(windows()).toEqual([['a0', 'f0:gf', 'f1:gf', 's0', 'a1']]);
  });

  test('past the row after it: the rows it passed hold still, and the room opens under that row', async () => {
    const { windows } = await renderSession(lone(true), FOLDED);
    const held = pickUp('s0');
    moveTo(200);
    expect(translateOf(titleOf('gf'))).toBe(0);
    expect(translateOf(row('a1'))).toBe(0);
    expect(slotTop(held, 100)).toBe(208);
    release(200);
    expect(windows()).toEqual([['a0', 'f0:gf', 'f1:gf', 'a1', 's0']]);
  });

  test('back above it, in the window: still held, nothing below closes up', async () => {
    const { windows } = await renderSession(lone(true), FOLDED);
    pickUp('s0');
    moveTo(180);
    moveTo(40);
    expect(translateOf(titleOf('gf'))).toBe(0);
    expect(translateOf(row('a1'))).toBe(0);
    release(40);
    expect(windows()).toEqual([['s0', 'a0', 'f0:gf', 'f1:gf', 'a1']]);
  });

  // R1. Out of the window the room closes: w2 is 220..284 (z0 252..284), the trailing block at 292.
  test('into another window: the emptied group closes up behind it', async () => {
    const { windows } = await renderSession(
      lone(true, [win('w2', [tab('z0')])]),
      {
        ...FOLDED,
        'win:w2': [220, 64],
        'row:z0': [252, ROW],
        [`win:${NEW_LAST_WINDOW}`]: [292, 0],
      }
    );
    pickUp('s0');
    moveTo(275);
    expect(translateOf(titleOf('gf'))).toBeLessThan(0);
    expect(translateOf(row('a1'))).toBeLessThan(0);
    release(275);
    expect(windows()).toEqual([
      ['a0', 'f0:gf', 'f1:gf', 'a1'],
      ['z0', 's0'],
    ]);
  });

  // CONTROL: over its own group the tab goes back.
  test('over its own group: back in it, and nothing moves', async () => {
    const { windows } = await renderSession(lone(true), FOLDED);
    pickUp('s0');
    moveTo(150);
    moveTo(110);
    expect(band('gs').hasAttribute('data-drop-target')).toBe(true);
    expect(translateOf(titleOf('gf'))).toBe(0);
    release(110);
    expect(windows()).toEqual([['a0', 's0:gs', 'f0:gf', 'f1:gf', 'a1']]);
  });

  test('on the open group’s title row: its title holds still and room opens under it; let go, it joins at the head', async () => {
    const { windows } = await renderSession(lone(false), OPEN);
    const held = pickUp('s0');
    moveTo(150);
    expect(band('gf').hasAttribute('data-drop-target')).toBe(true);
    expect(translateOf(titleOf('gf'))).toBe(0);
    expect(translateOf(row('f0'))).toBe(ROW);
    expect(translateOf(row('a1'))).toBe(ROW);
    expect(slotTop(held, 100)).toBe(172);
    release(150);
    expect(windows()).toEqual([['a0', 's0:gf', 'f0:gf', 'f1:gf', 'a1']]);
  });

  test('between it and the open group: its title row stays, the slot is its own room, and the tab lands loose', async () => {
    const { windows } = await renderSession(lone(false), OPEN);
    const held = pickUp('s0');
    moveTo(136);
    expect(band('gf').hasAttribute('data-drop-target')).toBe(false);
    expect(translateOf(titleOf('gs'))).toBe(0);
    expect(translateOf(titleOf('gf'))).toBe(0);
    expect(slotTop(held, 100)).toBe(100);
    release(136);
    expect(windows()).toEqual([['a0', 's0', 'f0:gf', 'f1:gf', 'a1']]);
  });

  test('past the open group’s first member: it holds still too, and the room opens after that member', async () => {
    const { windows } = await renderSession(lone(false), OPEN);
    const held = pickUp('s0');
    moveTo(200);
    expect(translateOf(titleOf('gf'))).toBe(0);
    expect(translateOf(row('f0'))).toBe(0);
    expect(translateOf(row('f1'))).toBe(ROW);
    expect(slotTop(held, 100)).toBe(204);
    release(200);
    expect(windows()).toEqual([['a0', 'f0:gf', 's0:gf', 'f1:gf', 'a1']]);
  });
});
