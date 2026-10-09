import { Profiler, createRef } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import OpenNowPane from '../../components/home/opennow/OpenNowPane';
import { CarryLayer } from '../../components/home/CarryLayer';
import {
  DraggableRow,
  RowDragArea,
} from '../../components/home/rightpane/rowDrag/RowDragArea';
import { currentCarry, endCarry } from '../../redux/carry';
import { currentDragCard, subscribeDragCard } from '../../redux/dragCard';
import { endDragHold } from '../../redux/dragHold';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  setSearchInputText,
  setHasTabGroupsPermission,
  setIsNotDirty,
} from '../../redux/slices/globalStateSlice';
import { renderWithProviders } from '../setup/renderWithProviders';
import { standInSessionList } from '../setup/standInSessionList';
import { s1, s2, s3, tabIds, windowIn } from '../fixtures/sessionMoveFixture';
import { snapshot, layOut, tabRow } from '../setup/openNowDragHarness';

// KAN-354 C1 A, C2 A. An ordinary drag inside a saved session's tab, group or
// window list hides the row it holds -- the row keeps its box, so its room,
// its translate and every number the engine reads from it -- and shows the
// card at the pointer instead, the one a carry shows (KAN-350). Only those
// three lists, and only where the list has a card to show (carryOut). The
// session list and Open now keep their sliding row with its lift shadow.
//
// jsdom applies emotion's rules to a computed style but never loads
// src/App.css, so the `!important` lift shadow App.css puts on a held TAB --
// KAN-355 -- is pinned in e2e/in-session-card.spec.ts. Here: the attribute
// that rule now keys on, and everything the engine draws itself.
//
// S1 (shown): w1 [t1, g1a*g1, g1b*g1, t2, t4*g2], w2 [t3]. Every box the
// engine reads is given one in the pane's content space (as
// openedSessionTakesCarry.test.tsx does); anything not listed is a zero box.

const PANE_W = 400;

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
  return DOMRect.fromRect({ x: 0, y: top, width: PANE_W, height });
}

// The tab list as drawn, every window open:
//
//   w1 0..256: header 0..32, t1 32..64, band g1 64..160 (title 64..96,
//              g1a 96..128, g1b 128..160), t2 160..192, band g2 192..256
//              (title 192..224, t4 224..256)
//   w2 264..328: header 264..296, t3 296..328
const TAB_LAYOUT: Table = {
  'win:w1': [0, 256],
  'row:tab:t1': [32, 32],
  'row:t1': [32, 32],
  'row:group:g1': [64, 96],
  'band:g1': [64, 96],
  'fixed:g1': [64, 32],
  'row:g1a': [96, 32],
  'row:g1b': [128, 32],
  'fixed:g1:tail': [160, 0],
  'row:tab:t2': [160, 32],
  'row:t2': [160, 32],
  'row:group:g2': [192, 64],
  'band:g2': [192, 64],
  'fixed:g2': [192, 32],
  'row:t4': [224, 32],
  'fixed:g2:tail': [256, 0],
  'win:w2': [264, 64],
  'row:tab:t3': [296, 32],
  'row:t3': [296, 32],
};

// The items list while g1 is held: the held group compressed to its title
// row (KAN-160), which is the layout its drag measures.
const GROUP_LAYOUT: Table = {
  'win:w1': [0, 192],
  'row:tab:t1': [32, 32],
  'row:group:g1': [64, 32],
  'row:tab:t2': [96, 32],
  'row:group:g2': [128, 64],
  'win:w2': [200, 64],
  'row:tab:t3': [232, 32],
};

// The windows list while a window is held: every window folded to its
// header (KAN-153).
const WINDOW_LAYOUT: Table = {
  'row:w1': [0, 32],
  'win:w1': [0, 32],
  'row:w2': [40, 32],
  'win:w2': [40, 32],
};

let unregisterList = () => {};
beforeEach(() => {
  // The session list, stood in left of the pane (x < 0), where the app draws
  // it: the only place a saved drag is handed to the carry (KAN-352).
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

const DETAIL = (
  <>
    <TabGroupDetailsContainer />
    <CarryLayer />
  </>
);

// A Chrome window with an active tab, for a click that reaches a row: it
// opens the tab beside the active one.
const ACTIVE_TAB = {
  windows: [
    {
      id: 1,
      tabs: [{ id: 1, url: 'https://x.test/', title: 'X', active: true }],
    },
  ],
};

async function renderDetail(seed?: typeof ACTIVE_TAB, ui = DETAIL) {
  const result = await renderWithProviders(ui, {
    seed,
    seedStore: (store) => {
      store.dispatch(setHasTabGroupsPermission(true));
      store.dispatch(saveToTabContainerInternal(s3()));
      store.dispatch(saveToTabContainerInternal(s2()));
      store.dispatch(saveToTabContainerInternal(s1()));
      store.dispatch(selectTabContainer('S1'));
      store.dispatch(setIsNotDirty());
    },
  });
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
const dragCard = () => document.querySelector<HTMLElement>('[data-drag-card]');
const carryCard = () =>
  document.querySelector<HTMLElement>('[data-carry-card]');
const slotOf = (held: HTMLElement): HTMLElement => {
  const slot = held.querySelector(':scope > [data-drag-landing-slot]');
  if (!(slot instanceof HTMLElement)) throw new Error('no landing slot');
  return slot;
};
// The held row's own children, the slots it draws excluded (the landing slot,
// and the outline of the room a cross-window drag leaves): what it draws of
// itself.
const contentOf = (held: HTMLElement): Element[] =>
  [...held.children].filter(
    (c) =>
      !c.hasAttribute('data-drag-landing-slot') &&
      !c.hasAttribute('data-drag-source-room')
  );
// Whether anything between the element and the page hides it. Opacity does
// not inherit in a computed style, so the element's own is not enough.
const seen = (el: Element) => {
  for (let e: Element | null = el; e !== null; e = e.parentElement) {
    const style = getComputedStyle(e);
    if (style.opacity === '0' || style.visibility === 'hidden') return false;
  }
  return true;
};

// Each saved list's press, 8px of travel down (past the activation distance,
// still over the row's own place), and the row it holds.
interface Kind {
  name: 'tab' | 'group' | 'window';
  layout: Table;
  held: string;
  // Where the press lands, and on what.
  pressY: number;
  press: () => HTMLElement;
  cardName: string;
}

const handleIn = (rowId: string, selector: string) => () => {
  const handle = row(rowId).querySelector(selector);
  if (!(handle instanceof HTMLElement)) throw new Error(`no ${selector}`);
  return handle;
};

const KINDS: Kind[] = [
  {
    name: 'tab',
    layout: TAB_LAYOUT,
    held: 't2',
    pressY: 176,
    press: () => row('t2'),
    cardName: 't2',
  },
  {
    name: 'group',
    layout: GROUP_LAYOUT,
    held: 'group:g1',
    pressY: 80,
    press: handleIn('group:g1', '[data-group-drag-handle]'),
    cardName: 'Group g1',
  },
  {
    name: 'window',
    layout: WINDOW_LAYOUT,
    held: 'w2',
    pressY: 56,
    press: handleIn('w2', '[data-window-drag-handle]'),
    cardName: 'Window w2',
  },
];

const X = 20;
const TAB = KINDS[0];

function pickUp(kind: Kind): HTMLElement {
  table = kind.layout;
  fireEvent.pointerDown(kind.press(), {
    clientX: X,
    clientY: kind.pressY,
    button: 0,
  });
  act(() => {
    fireEvent.pointerMove(document, { clientX: X, clientY: kind.pressY + 8 });
  });
  return row(kind.held);
}

const moveTo = (y: number, x = X) =>
  act(() => {
    fireEvent.pointerMove(document, { clientX: x, clientY: y });
  });
const release = (y: number, x = X) =>
  act(() => {
    fireEvent.pointerUp(document, { clientX: x, clientY: y });
  });

describe('a drag in a saved list is drawn by the card (KAN-354 C1 A)', () => {
  test.each(KINDS)(
    // Its room is the e2e's to see (in-session-card.spec.ts,
    // expectSlotAtOwnPlace): jsdom lays nothing out.
    'a $name: one drag card, and the held row hidden by opacity alone',
    async (kind) => {
      await renderDetail();
      // The premise: nothing is shown before the drag starts.
      expect(dragCard()).toBeNull();

      const held = pickUp(kind);

      expect(held.hasAttribute('data-drag-held')).toBe(true);
      expect(document.querySelectorAll('[data-drag-card]')).toHaveLength(1);
      expect(currentDragCard()?.card.kind).toBe(kind.name);
      expect(dragCard()?.textContent).toContain(kind.cardName);
      // At the pointer, where a carry's card sits (+8, +4).
      expect(dragCard()?.style.transform).toBe(
        `translate(${X + 8}px, ${kind.pressY + 12}px)`
      );
      // A drag card, not a carry: nothing has reached the session list.
      expect(carryCard()).toBeNull();
      expect(currentCarry()).toBeNull();

      // The row is drawn by the card: marked so App.css can leave it alone,
      // its content invisible, and no lift shadow of its own.
      expect(held.hasAttribute('data-held-as-card')).toBe(true);
      expect(document.querySelectorAll('[data-held-as-card]')).toHaveLength(1);
      const content = contentOf(held);
      expect(content.length).toBeGreaterThan(0);
      for (const c of content) expect(getComputedStyle(c).opacity).toBe('0');
      expect(held.style.boxShadow).toBe('');

      // The landing slot is the row's own place at pick-up, distance 0, and
      // stands at full strength: nothing is left there to tell it from.
      const slot = slotOf(held);
      expect(slot.style.opacity).toBe('1');
      expect(seen(slot)).toBe(true);

      // Still hit by the pointer: the release's click is aimed at the held
      // row (KAN-177), so the row is hidden by opacity alone.
      expect(getComputedStyle(held).pointerEvents).not.toBe('none');
      expect(getComputedStyle(held).visibility).not.toBe('hidden');
      expect(held.inert).not.toBe(true);
      // The property alone cannot see an `inert` attribute: jsdom has no
      // `inert` property, so it reads undefined whatever the markup says.
      expect(held.hasAttribute('inert')).toBe(false);

      act(() => {
        fireEvent.keyDown(window, { key: 'Escape' });
      });
      release(kind.pressY + 8);
    }
  );

  test('the card follows the pointer', async () => {
    await renderDetail();
    pickUp(TAB);

    moveTo(120, 60);

    expect(dragCard()?.style.transform).toBe('translate(68px, 124px)');
    expect(currentDragCard()).toMatchObject({ x: 60, y: 120 });
    release(120, 60);
  });

  test('the slot keeps full strength wherever the row is held', async () => {
    await renderDetail();
    const held = pickUp(TAB);

    // Half a row off its own place, and over t1's slot: on main both faded
    // the slot by its distance to the (visible) held row.
    for (const y of [180, 190, 44]) {
      moveTo(y);
      expect(slotOf(held).style.opacity).toBe('1');
    }
    release(44);
  });
});

describe('every end takes the drag card down', () => {
  test('Esc', async () => {
    await renderDetail();
    const held = pickUp(TAB);
    expect(dragCard()).not.toBeNull();

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    expect(dragCard()).toBeNull();
    expect(currentDragCard()).toBeNull();
    expect(held.hasAttribute('data-held-as-card')).toBe(false);
    release(184);
  });

  test('pointercancel', async () => {
    await renderDetail();
    pickUp(TAB);
    expect(dragCard()).not.toBeNull();

    act(() => {
      fireEvent.pointerCancel(window);
    });

    expect(dragCard()).toBeNull();
  });

  test('a refused release', async () => {
    const { store } = await renderDetail();
    const before = store.getState().tabContainerDataState;
    pickUp(TAB);
    expect(dragCard()).not.toBeNull();

    // Below every window and outside the pane: refused.
    moveTo(600, 100);
    release(600, 100);

    expect(dragCard()).toBeNull();
    // The premise: it was refused, not committed.
    expect(store.getState().tabContainerDataState).toBe(before);
  });

  test('a committed release', async () => {
    const { store } = await renderDetail();
    pickUp(TAB);
    expect(dragCard()).not.toBeNull();

    // Above t1's midpoint: t2 lands first in w1.
    moveTo(40);
    release(40);

    expect(dragCard()).toBeNull();
    // The premise: it committed.
    expect(
      tabIds(windowIn(store.getState().tabContainerDataState, 'S1', 'w1'))
    ).toEqual(['t2', 't1', 'g1a', 'g1b', 't4']);
  });

  test('the list turning drag off mid-drag', async () => {
    const { store } = await renderDetail();
    pickUp(TAB);
    expect(dragCard()).not.toBeNull();

    // Every window is titled 'Window <id>': searching, with every row kept.
    act(() => {
      store.dispatch(setSearchInputText('window'));
    });

    // The premise: the area is still there, and dropped the drag itself.
    expect(row('t2').hasAttribute('data-drag-held')).toBe(false);
    expect(dragCard()).toBeNull();
    release(184);
  });

  test('the area unmounting mid-drag', async () => {
    const { rerender } = await renderDetail();
    pickUp(TAB);
    expect(dragCard()).not.toBeNull();

    // The detail goes; the layer that draws the card stays.
    rerender(<CarryLayer />);

    // The premise: the list is gone.
    expect(document.querySelector('[data-drag-row-id="t2"]')).toBeNull();
    expect(dragCard()).toBeNull();
    expect(currentDragCard()).toBeNull();
  });
});

describe('the hand-off to the carry', () => {
  test('the drag card becomes the carry card: the same node, never removed', async () => {
    await renderDetail();
    pickUp(TAB);
    const el = dragCard();
    expect(el).not.toBeNull();
    const removed: Node[] = [];
    const observer = new MutationObserver((records) => {
      for (const r of records) removed.push(...Array.from(r.removedNodes));
    });
    observer.observe(document.body, { subtree: true, childList: true });
    // Whether a carry was on at the moment the drag card went. The DOM
    // cannot say: act renders both changes at once, in either order.
    const carryOnWhenHidden: boolean[] = [];
    const unsubscribe = subscribeDragCard(() => {
      if (currentDragCard() === null)
        carryOnWhenHidden.push(currentCarry() !== null);
    });

    // Onto the stood-in session list.
    moveTo(184, -40);
    unsubscribe();

    // The carry started BEFORE the drag card was hidden: CarryLayer draws
    // `carry ?? dragCard`, so at no moment was there neither.
    expect(carryOnWhenHidden).toEqual([true]);
    expect(currentCarry()?.carried).toMatchObject({ tabId: 't2' });
    expect(carryCard()).toBe(el);
    expect(el?.style.transform).toBe('translate(-32px, 188px)');
    expect(dragCard()).toBeNull();
    expect(currentDragCard()).toBeNull();
    // takeRecords, not the callback: the callback runs after this test body.
    removed.push(
      ...observer.takeRecords().flatMap((r) => Array.from(r.removedNodes))
    );
    observer.disconnect();
    expect(removed).not.toContain(el);
  });
});

// KAN-359. The card and the hidden row arrive in ONE commit. In the popup the
// card went up from activation, on the pointermove itself: CarryLayer reads it
// through useSyncExternalStore, which renders on the sync lane, in a
// microtask, inside the same frame. The row is hidden by the engine's
// setDrag, which a native pointermove schedules on the continuous lane, as a
// later task, after that frame has painted -- so two frames drew both the
// card and the row it stands for (e2e/in-session-card.spec.ts, "the pick-up,
// frame by frame").
//
// RTL's fireEvent runs inside act, which renders both lanes together and so
// cannot show the gap. The events below are dispatched as the browser
// dispatches them, outside act, so each update waits in its own lane exactly
// as it does in the popup.
declare global {
  // React's own flag (react-dom reads it off the global object); RTL sets it.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('the pick-up arrives in one commit (KAN-359)', () => {
  let actEnvironment: boolean | undefined;
  beforeEach(() => {
    actEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  afterEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
  });

  // Every card dragCard.ts publishes, as the layer would read it, with
  // whether the row it stands for was already hidden at that moment.
  interface Published {
    x: number;
    y: number;
    rowHidden: boolean;
  }
  function recordCards(held: HTMLElement): {
    published: Published[];
    stop: () => void;
  } {
    const published: Published[] = [];
    const stop = subscribeDragCard(() => {
      const card = currentDragCard();
      if (card === null) return;
      published.push({
        x: card.x,
        y: card.y,
        rowHidden:
          held.hasAttribute('data-held-as-card') &&
          contentOf(held).every((c) => getComputedStyle(c).opacity === '0'),
      });
    });
    return { published, stop };
  }

  // Outside act, as the browser dispatches them -- `window.event` included,
  // which is what React reads to pick an update's lane. jsdom's own stops
  // working the first time React handles an event. react-dom's dev build
  // assigns `window.event` (invokeGuardedCallbackDev), and that lands in
  // vitest's jsdom environment, not in jsdom: populateGlobal puts each
  // window key on the global behind a setter that stores the value in an
  // `overrideObject`, and a getter that answers it from then on, in place
  // of jsdom's. So it answers that event for good -- here the press's
  // pointerdown, a DISCRETE event, which put the engine's setDrag on the
  // sync lane with the card and hid the gap this test is about. (Plain
  // jsdom, with the same assignment and descriptor restore, keeps
  // answering the event being dispatched.) So the dispatch says what the
  // browser would.
  const dispatchAsBrowser = (event: Event) => {
    const before = Object.getOwnPropertyDescriptor(window, 'event');
    Object.defineProperty(window, 'event', {
      configurable: true,
      get: () => event,
    });
    try {
      window.dispatchEvent(event);
    } finally {
      if (before === undefined) Reflect.deleteProperty(window, 'event');
      else Object.defineProperty(window, 'event', before);
    }
  };
  const nativeMove = (x: number, y: number) =>
    dispatchAsBrowser(
      new PointerEvent('pointermove', { clientX: x, clientY: y })
    );
  const nativeEscape = () =>
    dispatchAsBrowser(new KeyboardEvent('keydown', { key: 'Escape' }));
  // What the sync lane needs: React flushes it in a microtask.
  const microtasks = async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };
  // What every other lane needs: the Scheduler runs it as a later task.
  const tasks = () => new Promise<void>((resolve) => setTimeout(resolve, 50));

  test.each(KINDS)(
    'a $name: the card is published once, after the row it stands for is hidden, and then only moved',
    async (kind) => {
      await renderDetail();
      const held = row(kind.held);
      const { published, stop } = recordCards(held);

      pickUp(kind);
      // Each move re-renders the area with a new drag state: none of those
      // renders may put the card up again.
      moveTo(kind.pressY + 20);
      moveTo(kind.pressY + 30, X + 5);
      stop();

      expect(published).toEqual([
        { x: X, y: kind.pressY + 8, rowHidden: true },
        { x: X, y: kind.pressY + 20, rowHidden: true },
        { x: X + 5, y: kind.pressY + 30, rowHidden: true },
      ]);

      act(() => {
        fireEvent.keyDown(window, { key: 'Escape' });
      });
      release(kind.pressY + 30, X + 5);
    }
  );

  test('in the browser’s order: no card until the commit that hides the row, then both, at the latest pointer', async () => {
    // Whether the card was up in the commit that first hid the row. A
    // Profiler's onRender runs in that commit's layout phase, after every
    // layout effect inside it -- the area's included. A card shown from a
    // passive effect would still be down there, and a frame could paint the
    // hidden row with no card.
    const cardUpWhenHidden: boolean[] = [];
    const onCommit = () => {
      const el = document.querySelector('[data-drag-row-id="t2"]');
      if (
        el?.hasAttribute('data-held-as-card') === true &&
        cardUpWhenHidden.length === 0
      )
        cardUpWhenHidden.push(currentDragCard() !== null);
    };
    await renderDetail(
      undefined,
      <>
        <Profiler id="detail" onRender={onCommit}>
          <TabGroupDetailsContainer />
        </Profiler>
        <CarryLayer />
      </>
    );
    table = TAB.layout;
    const held = row(TAB.held);
    fireEvent.pointerDown(TAB.press(), {
      clientX: X,
      clientY: TAB.pressY,
      button: 0,
    });
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    const { published, stop } = recordCards(held);

    nativeMove(X, TAB.pressY + 8);
    await microtasks();

    // The premise: the drag has started -- activate writes the marker
    // straight to the DOM -- and React has not yet rendered its state.
    expect(held.hasAttribute('data-drag-held')).toBe(true);
    expect(held.hasAttribute('data-held-as-card')).toBe(false);
    // The claim: nor is the card up. The pick-up looks as it does on main.
    expect(dragCard()).toBeNull();
    expect(currentDragCard()).toBeNull();

    // A second move before the commit: the card goes up where the pointer
    // IS, not where the drag started.
    nativeMove(X, TAB.pressY + 20);
    await tasks();
    stop();

    expect(held.hasAttribute('data-held-as-card')).toBe(true);
    expect(dragCard()).not.toBeNull();
    expect(cardUpWhenHidden).toEqual([true]);
    expect(published).toEqual([{ x: X, y: TAB.pressY + 20, rowHidden: true }]);

    nativeEscape();
    await tasks();
    expect(dragCard()).toBeNull();
    globalThis.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
    release(TAB.pressY + 20);
  });

  test('Esc before that commit: no card is ever shown', async () => {
    await renderDetail();
    table = TAB.layout;
    const held = row(TAB.held);
    fireEvent.pointerDown(TAB.press(), {
      clientX: X,
      clientY: TAB.pressY,
      button: 0,
    });
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    const { published, stop } = recordCards(held);

    nativeMove(X, TAB.pressY + 8);
    // The premise: the drag started.
    expect(held.hasAttribute('data-drag-held')).toBe(true);
    nativeEscape();
    await tasks();
    stop();

    expect(published).toEqual([]);
    expect(dragCard()).toBeNull();
    expect(currentDragCard()).toBeNull();
    expect(held.hasAttribute('data-drag-held')).toBe(false);
    expect(held.hasAttribute('data-held-as-card')).toBe(false);
    globalThis.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
    release(TAB.pressY + 8);
  });

  test('a hand-off before that commit: the carry’s card, and never a drag card', async () => {
    await renderDetail();
    table = TAB.layout;
    const held = row(TAB.held);
    fireEvent.pointerDown(TAB.press(), {
      clientX: X,
      clientY: TAB.pressY,
      button: 0,
    });
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    const { published, stop } = recordCards(held);

    nativeMove(X, TAB.pressY + 8);
    // Onto the stood-in session list, before React has rendered the drag.
    nativeMove(-40, TAB.pressY + 8);
    await tasks();
    stop();

    // The premise: the drag was handed off.
    expect(currentCarry()?.carried).toMatchObject({ tabId: 't2' });
    expect(carryCard()).not.toBeNull();
    // The claim: the drag card never went up, and is not up now.
    expect(published).toEqual([]);
    expect(dragCard()).toBeNull();
    expect(currentDragCard()).toBeNull();
    expect(held.hasAttribute('data-drag-held')).toBe(false);
    globalThis.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
    act(() => endCarry('cancelled'));
  });
});

// The click Chrome synthesizes for the release is aimed at the held row
// (KAN-177), hidden or not. The rules of dragSuppressesClick.test.tsx, run
// again with a card on: the drag's own click is swallowed, the one after it
// is not, and a press that never became a drag is a click.
describe('the release’s click, with a card on', () => {
  let clicks = 0;
  const count = () => {
    clicks += 1;
  };
  beforeEach(() => {
    clicks = 0;
    document.addEventListener('click', count);
  });
  afterEach(() => {
    document.removeEventListener('click', count);
  });

  const clickable = (title: string) =>
    screen.getByLabelText(`Open in new tab: ${title}`);

  test('a drag’s own click is swallowed, and only that one', async () => {
    await renderDetail(ACTIVE_TAB);
    pickUp(TAB);
    // The premise: the card is on.
    expect(dragCard()).not.toBeNull();
    moveTo(190);
    release(190);
    fireEvent.click(clickable('t2'), { clientX: X, clientY: 190 });
    expect(clicks).toBe(0);

    fireEvent.pointerDown(clickable('t1'), {
      clientX: X,
      clientY: 48,
      button: 0,
    });
    fireEvent.pointerUp(document, { clientX: X, clientY: 48 });
    fireEvent.click(clickable('t1'), { clientX: X, clientY: 48 });
    expect(clicks).toBe(1);
  });

  test('CONTROL: a press that never crosses the threshold shows no card and clicks', async () => {
    await renderDetail(ACTIVE_TAB);
    table = TAB_LAYOUT;
    fireEvent.pointerDown(row('t2'), { clientX: X, clientY: 176, button: 0 });
    moveTo(178);
    expect(dragCard()).toBeNull();
    release(178);
    fireEvent.click(clickable('t2'), { clientX: X, clientY: 178 });
    expect(clicks).toBe(1);
  });
});

// CONTROLS (C2 A): where the drag has no card, the held row is today's --
// visible, lifted, its slot fading by distance -- at the same travel a saved
// list now shows a card at.
describe('CONTROLS: no card, the old look', () => {
  // What a lifted row looks like, slot included: the expected fade is the
  // travel (8px) over the row's footprint.
  function expectLifted(held: HTMLElement, fade: string) {
    expect(held.hasAttribute('data-drag-held')).toBe(true);
    expect(dragCard()).toBeNull();
    expect(currentDragCard()).toBeNull();
    expect(held.hasAttribute('data-held-as-card')).toBe(false);
    expect(held.style.boxShadow).toContain('0.35');
    // The premise: the row has content to be seen.
    expect(contentOf(held).length).toBeGreaterThan(0);
    for (const c of contentOf(held)) expect(seen(c)).toBe(true);
    expect(slotOf(held).style.opacity).toBe(fade);
  }

  test('the session list', async () => {
    await renderWithProviders(
      <>
        <TabGroupEntryContainer />
        <CarryLayer />
      </>,
      {
        seedStore: (store) => {
          store.dispatch(saveToTabContainerInternal(s3()));
          store.dispatch(saveToTabContainerInternal(s2()));
          store.dispatch(saveToTabContainerInternal(s1()));
        },
      }
    );
    // Each session row 40px tall, in the order drawn.
    const ids = [
      ...document.querySelectorAll<HTMLElement>('[data-drag-row-id]'),
    ].map((el) => el.dataset.dragRowId ?? '');
    table = Object.fromEntries(
      ids.map((id, i): [string, [number, number]] => [
        `row:${id}`,
        [i * 40, 40],
      ])
    );
    const at = ids.indexOf('S2') * 40 + 20;
    const held = row('S2');

    fireEvent.pointerDown(held, { clientX: X, clientY: at, button: 0 });
    moveTo(at + 8);

    expectLifted(held, '0.2');
    release(at + 8);
  });

  test('Open now', async () => {
    const seed = {
      windows: [
        {
          id: 1,
          tabs: [
            { id: 11, url: 'https://a.test/', title: 'A', active: true },
            { id: 12, url: 'https://b.test/', title: 'B' },
          ],
        },
      ],
    };
    const props = {
      actions: [],
      headingId: 'open-now-heading',
      searchText: '',
      onSearchTextChange: () => undefined,
      searchInputRef: createRef<HTMLInputElement>(),
      onMoved: () => undefined,
    };
    const result = await renderWithProviders(
      <>
        <OpenNowPane windows={null} {...props} />
        <CarryLayer />
      </>,
      { seed }
    );
    const windows = await snapshot(false);
    result.rerender(
      <>
        <OpenNowPane windows={windows} {...props} />
        <CarryLayer />
      </>
    );
    await screen.findAllByRole('button', { name: /^Switch to tab: / });
    const top = layOut(windows);
    const at = (top.get('12') ?? 0) + 16;

    fireEvent.pointerDown(tabRow(12), { clientX: X, clientY: at, button: 0 });
    moveTo(at + 8);

    expectLifted(tabRow(12), '0.25');
    release(at + 8);
  });

  // The rule is "this drag has a card", not "this list has carryOut": a
  // list whose carryOut has nothing for the held row draws it as today. In
  // the app the groups list's carryOut is null for a loose tab, which that
  // list never lets a press pick up; the engine is held to it directly.
  test('a list whose carryOut has nothing for the held row', async () => {
    await renderWithProviders(
      <>
        <RowDragArea
          rowIds={['a', 'b']}
          onMove={() => undefined}
          carryOut={() => null}
        >
          <DraggableRow rowId="a">
            <div>Row A</div>
          </DraggableRow>
          <DraggableRow rowId="b">
            <div>Row B</div>
          </DraggableRow>
        </RowDragArea>
        <CarryLayer />
      </>
    );
    table = { 'row:a': [0, 32], 'row:b': [32, 32] };

    fireEvent.pointerDown(row('a'), { clientX: X, clientY: 16, button: 0 });
    moveTo(24);

    expectLifted(row('a'), '0.25');
    release(24);
  });
});
