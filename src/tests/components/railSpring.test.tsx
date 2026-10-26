import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import MainContainer from '../../components/MainContainer';
import { OPEN_NOW_RAIL_QUERY } from '../../components/home/opennow/railQuery';
import { SPRING_OPEN_MS } from '../../components/common/springOpen';
import { setDragging } from '../../components/home/rightpane/rowDrag/dropRules';
import { NEW_LAST_WINDOW } from '../../components/home/rightpane/newWindowTarget';
import {
  renderWithProviders,
  type RenderWithProvidersResult,
} from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';
import { asWritten } from '../setup/asWritten';
import { classRulesFor } from '../setup/hoverRules';
import {
  saveToTabContainerInternal,
  selectTabContainer,
  type CarriedRef,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  recordFirstRun,
  setFoldOpenNowInTabView,
  setFoldSavedSessionInTabView,
} from '../../redux/slices/settingsDataStateSlice';
import { runShownHere } from '../../redux/slices/globalStateSlice';
import { newRun } from '../../utils/functions/firstRun';
import { buildSession } from '../fixtures/sessionFixture';
import { live } from '../fixtures/liveSnapshotFixture';
import {
  carryEndedAs,
  currentCarry,
  endCarry,
  setCarryOpens,
  startCarry,
  type CarryCard,
} from '../../redux/carry';
import { liveItem, savedItem } from '../../redux/carriedItem';
import { beginDragHold, endDragHold } from '../../redux/dragHold';
import { LIGHT_THEME } from '../../hooks/useThemeColors';

// KAN-820 E. A saved carry resting 600ms on Currently open's rail springs the drawer out, without moving focus.
// jsdom has no layout: the rail is stubbed at x 980..1024 (jsdom's innerWidth), y 0..800.

const RAIL_NAME = 'Currently open, 3 Tabs';
const RAIL_BOX = DOMRect.fromRect({ x: 980, y: 0, width: 44, height: 800 });
// The drawer over the right side, the rail under it.
const DRAWER_BOX = DOMRect.fromRect({ x: 644, y: 0, width: 380, height: 800 });
const ON_RAIL = { x: 1000, y: 300 };
const OFF_RAIL = { x: 300, y: 300 };
const REDUCED = '(prefers-reduced-motion: reduce)';

const twoWindows = (): ChromeSeed => ({
  windows: [
    {
      id: 1,
      focused: true,
      tabs: [{ title: 'A', url: 'https://a.test/', active: true }],
    },
    {
      id: 2,
      focused: false,
      tabs: [
        { title: 'B', url: 'https://b.test/', active: false },
        { title: 'C', url: 'https://c.test/', active: true },
      ],
    },
  ],
});

const TAB: CarriedRef = {
  kind: 'tab',
  tabGroupId: 'first',
  windowId: 'window-1',
  tabId: 'tab-1',
};
const CARD: CarryCard = { kind: 'tab', title: 'Example', faviconUrl: '' };

let railQuery: FakeMediaQueryList;

function installMatchMedia(narrow: boolean, reducedMotion = false) {
  railQuery = new FakeMediaQueryList(OPEN_NOW_RAIL_QUERY, narrow);
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) =>
    query === OPEN_NOW_RAIL_QUERY
      ? railQuery
      : new FakeMediaQueryList(query, query === REDUCED && reducedMotion)
  );
}

// The saved session's window with three tabs, so a move of tab-1 shows in the store.
function threeTabSession() {
  const base = buildSession({ tabGroupId: 'first', title: 'First session' });
  const tabs = ['tab-1', 'tab-2', 'tab-3'].map((tabId) => ({
    tabId,
    favicon: '',
    title: tabId,
    url: `https://${tabId}.test/`,
  }));
  return {
    ...base,
    tabCount: 3,
    windows: base.windows.map((w) => ({ ...w, tabCount: 3, tabs })),
  };
}

async function renderHome(
  options: { tour?: boolean; foldOpenNow?: boolean; threeTabs?: boolean } = {}
) {
  const result = await renderWithProviders(<MainContainer />, {
    seed: twoWindows(),
    seedStore: (store) => {
      store.dispatch(
        saveToTabContainerInternal(
          options.threeTabs === true
            ? threeTabSession()
            : buildSession({ tabGroupId: 'first', title: 'First session' })
        )
      );
      store.dispatch(selectTabContainer('first'));
      store.dispatch(setFoldSavedSessionInTabView(false));
      if (options.foldOpenNow === true) {
        store.dispatch(setFoldOpenNowInTabView(true));
      }
      if (options.tour === true) {
        store.dispatch(
          recordFirstRun({ ...newRun('full', 6), sessionId: 'first' })
        );
        store.dispatch(runShownHere());
      }
    },
  });
  const button = await screen.findByRole('button', { name: RAIL_NAME });
  // Timers are faked after the render: i18n's init must settle first.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  rail().getBoundingClientRect = () => RAIL_BOX;
  return { ...result, button };
}

function rail(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-open-now-rail]');
  if (el === null) throw new Error('no rail');
  return el;
}
const drawer = () => document.querySelector('[data-pane-layer="drawer"]');
const opens = () => document.documentElement.hasAttribute('data-carry-opens');
// The drawer's heading, which names it.
function heading(): HTMLElement {
  const id = drawer()?.getAttribute('aria-labelledby');
  const el = id == null ? null : document.getElementById(id);
  if (el === null) throw new Error('no drawer heading');
  return el;
}
const isTarget = () => rail().hasAttribute('data-carry-target');
const isSweeping = () => rail().hasAttribute('data-carry-dwell');

// As the engine leaves things at a hand-off: held, kind published, carried, off the rail.
function carrySaved(ref: CarriedRef = TAB) {
  setDragging(true, ref.kind);
  beginDragHold();
  const item = savedItem(ref);
  act(() => startCarry(item, CARD, OFF_RAIL.x, OFF_RAIL.y));
  return item;
}
function carryLive() {
  setDragging(true, 'tab');
  beginDragHold();
  act(() =>
    startCarry(
      liveItem({
        pick: { kind: 'tab', windowId: 'live-w', tabId: 'l1' },
        window: live(),
        chromeWindowId: 7,
      }),
      CARD,
      OFF_RAIL.x,
      OFF_RAIL.y
    )
  );
}

const moveTo = ({ x, y }: { x: number; y: number }) =>
  fireEvent.pointerMove(document, { clientX: x, clientY: y });
const releaseAt = ({ x, y }: { x: number; y: number }) =>
  fireEvent.pointerUp(document, { clientX: x, clientY: y });
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
// Lets a settled drawer's promise chain run.
const flush = () => act(async () => {});

function drawerEl(): HTMLElement {
  const el = drawer();
  if (!(el instanceof HTMLElement)) throw new Error('no drawer');
  return el;
}
// The pane's header lies above its scroller, here y 400.
const IN_HEADER = { x: 700, y: 100 };
// The drawer over the right side, as drawn and where it rests (test-only stubs: jsdom lays nothing out).
function placeDrawer(el: HTMLElement) {
  el.getBoundingClientRect = () => DRAWER_BOX;
  for (const [key, value] of [
    ['offsetLeft', DRAWER_BOX.left],
    ['offsetTop', DRAWER_BOX.top],
    ['offsetWidth', DRAWER_BOX.width],
    ['offsetHeight', DRAWER_BOX.height],
  ] as const) {
    Object.defineProperty(el, key, { configurable: true, value });
  }
}
// Lays the drawer out over the right side, its pane filling it.
function layOutDrawer() {
  const el = drawerEl();
  placeDrawer(el);
  const pane = el.querySelector<HTMLElement>('[role="region"]');
  const scroller = el.querySelector<HTMLElement>('[data-open-now-scroller]');
  if (pane === null || scroller === null) throw new Error('no pane');
  pane.getBoundingClientRect = () => DRAWER_BOX;
  scroller.getBoundingClientRect = () =>
    DOMRect.fromRect({ x: 644, y: 400, width: 380, height: 400 });
}
// Rests on the rail until the drawer springs, laid out before it settles.
async function springDrawer() {
  moveTo(ON_RAIL);
  wait(SPRING_OPEN_MS);
  layOutDrawer();
  await flush();
}
const isSettling = () => drawerEl().hasAttribute('data-drawer-settling');

// The drawer's motion, held until the test lets it end (test-only stub: jsdom has no Animation).
function holdDrawerMotion() {
  let end = () => {};
  const finished = new Promise<void>((resolve) => {
    end = resolve;
  });
  const motion = { finished, playState: 'running' } as unknown as Animation;
  vi.spyOn(Element.prototype, 'getAnimations').mockImplementation(function (
    this: Element
  ) {
    return this.matches('[data-pane-layer="drawer"]') ? [motion] : [];
  });
  return () => act(async () => end());
}

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '?view=tab');
});

afterEach(() => {
  act(() => endCarry('cancelled'));
  endDragHold();
  document.documentElement.removeAttribute('data-dragging');
  vi.useRealTimers();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
  localStorage.clear();
});

describe('narrow, a saved carry on the rail (KAN-820 E)', () => {
  test('a saved carry on the rail is its target, outlined, sweeping from the right', async () => {
    installMatchMedia(true);
    await renderHome();
    carrySaved();
    // CONTROL: off the rail, no target.
    expect(isTarget()).toBe(false);

    moveTo(ON_RAIL);

    expect(isTarget()).toBe(true);
    expect(isSweeping()).toBe(true);
    const style = getComputedStyle(rail());
    expect(style.backgroundPosition).toContain('right');
    expect(style.outlineWidth).toBe('2px');
    expect(style.outlineStyle).toBe('solid');
    expect(style.outlineColor).toMatch(asWritten(LIGHT_THEME.LABEL_L2_COLOR));
  });

  // jsdom applies no :hover or :active, so the injected rules are what can be read.
  test('while the rail is a target its button shows no hover or press fill', async () => {
    installMatchMedia(true);
    await renderHome();
    const rules = classRulesFor(rail()).split('\n');
    for (const state of ['', ':hover', ':active']) {
      const selector = new RegExp(
        `\\[data-carry-target\\] ?> ?button${state}(,|\\s*\\{)`
      );
      const rule = rules.find((r) => selector.test(r));
      expect(rule, `no rule for the target's button${state}`).toMatch(
        /background-color: transparent/
      );
    }
  });

  test('after 600ms the drawer opens, and focus stays where it was', async () => {
    installMatchMedia(true);
    const { button } = await renderHome();
    button.focus();
    carrySaved();
    moveTo(ON_RAIL);

    wait(SPRING_OPEN_MS - 1);
    expect(drawer()).toBeNull();
    wait(1);
    expect(drawer()).not.toBeNull();
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement).toBe(button);
    // Under the drawer the rail is no longer the target, before the next move.
    expect(isTarget()).toBe(false);
  });

  test('off the rail at 599ms, nothing opens. Back on, the 600ms starts again', async () => {
    installMatchMedia(true);
    await renderHome();
    carrySaved();
    moveTo(ON_RAIL);
    wait(SPRING_OPEN_MS - 1);
    moveTo(OFF_RAIL);
    expect(isTarget()).toBe(false);
    wait(SPRING_OPEN_MS * 2);
    expect(drawer()).toBeNull();

    moveTo(ON_RAIL);
    wait(SPRING_OPEN_MS - 1);
    expect(drawer()).toBeNull();
    wait(1);
    expect(drawer()).not.toBeNull();
  });

  test('a release on the rail cancels: nothing opens, no +', async () => {
    installMatchMedia(true);
    await renderHome();
    carrySaved();
    // As a receiver that left the + on would (only Currently open's turn it on, and their leave clears it).
    act(() => setCarryOpens(true));
    // PREMISE: the + is on before the rail is reached.
    expect(opens()).toBe(true);
    moveTo(ON_RAIL);
    // Resting on the rail, letting go opens nothing, so the card has no +.
    expect(opens()).toBe(false);
    wait(300);
    fireEvent.pointerUp(document, { clientX: ON_RAIL.x, clientY: ON_RAIL.y });

    expect(currentCarry()).toBeNull();
    expect(isTarget()).toBe(false);
    wait(SPRING_OPEN_MS * 2);
    expect(drawer()).toBeNull();
  });

  // R1: a spring into a drawer already open must not eat the next open's focus.
  test('a rest on the rail beside a user-opened drawer sent away leaves the next open focusing the heading', async () => {
    installMatchMedia(true);
    const { button } = await renderHome();
    fireEvent.click(button);
    const open = drawer();
    if (!(open instanceof HTMLElement)) throw new Error('no drawer');
    placeDrawer(open);
    // PREMISE: the button's open focuses the heading.
    expect(document.activeElement).toBe(heading());

    // In, then out of the drawer: it goes away, so the rail is uncovered.
    carrySaved();
    moveTo(IN_HEADER);
    moveTo(OFF_RAIL);
    expect(open).toHaveAttribute('data-carry-away');
    moveTo(ON_RAIL);
    expect(isTarget()).toBe(true);
    wait(SPRING_OPEN_MS);
    await flush();
    // User-opened, it stays after an Esc, so the button closes it next.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(currentCarry()).toBeNull();

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    act(() => {
      fireEvent.animationEnd(open);
    });
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement).toBe(heading());
  });

  test("past the window's right edge is still the rail", async () => {
    installMatchMedia(true);
    await renderHome();
    carrySaved();
    moveTo({ x: window.innerWidth + 50, y: ON_RAIL.y });

    expect(isTarget()).toBe(true);
    wait(SPRING_OPEN_MS);
    expect(drawer()).not.toBeNull();
  });

  test('a live carry gets no rail target', async () => {
    installMatchMedia(true);
    await renderHome();
    carryLive();
    moveTo(ON_RAIL);

    expect(isTarget()).toBe(false);
    wait(SPRING_OPEN_MS * 2);
    expect(drawer()).toBeNull();
  });

  test("the tour's sample gets no rail target", async () => {
    installMatchMedia(true);
    await renderHome({ tour: true });
    carrySaved();
    moveTo(ON_RAIL);

    expect(isTarget()).toBe(false);
    wait(SPRING_OPEN_MS * 2);
    expect(drawer()).toBeNull();
  });

  test('under reduced motion: solid fill, no sweep, still opens at 600ms', async () => {
    installMatchMedia(true, true);
    await renderHome();
    carrySaved();
    moveTo(ON_RAIL);

    expect(isTarget()).toBe(true);
    expect(isSweeping()).toBe(false);
    expect(getComputedStyle(rail()).backgroundColor).toMatch(
      asWritten(LIGHT_THEME.ACTIVE_COLOR)
    );
    wait(SPRING_OPEN_MS - 1);
    expect(drawer()).toBeNull();
    wait(1);
    expect(drawer()).not.toBeNull();
  });

  test('unmounting the rail mid-dwell springs nothing', async () => {
    installMatchMedia(true);
    await renderHome();
    carrySaved();
    moveTo(ON_RAIL);
    wait(300);
    // PREMISE: the dwell is running.
    expect(isSweeping()).toBe(true);
    const timersBefore = vi.getTimerCount();

    act(() => railQuery.setMatches(false));

    expect(document.querySelector('[data-open-now-rail]')).toBeNull();
    // The rail's own timer went with it.
    expect(vi.getTimerCount()).toBeLessThan(timersBefore);
    expect(() => wait(SPRING_OPEN_MS)).not.toThrow();
    expect(drawer()).toBeNull();
  });
});

// KAN-820. The drawer goes away only after the carry was in it and left; a sprung one stays at the end only if
// the carry ended inside it, not by Esc.
describe('the drawer under a carry (KAN-820)', () => {
  test('in, then out: away. Back on the rail: springs again', async () => {
    installMatchMedia(true);
    const { button } = await renderHome();
    carrySaved();
    await springDrawer();
    const sprung = drawerEl();

    moveTo(IN_HEADER);
    expect(sprung).not.toHaveAttribute('data-carry-away');
    moveTo(OFF_RAIL);
    expect(sprung).toHaveAttribute('data-carry-away');

    moveTo(ON_RAIL);
    expect(isTarget()).toBe(true);
    wait(SPRING_OPEN_MS - 1);
    expect(sprung).toHaveAttribute('data-carry-away');
    wait(1);
    expect(sprung).not.toHaveAttribute('data-carry-away');
    // Back, not remounted.
    expect(drawerEl()).toBe(sprung);
    await flush();
    releaseAt(ON_RAIL);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(sprung).not.toHaveAttribute('data-carry-away');
  });

  test('sprung, released inside on a refused spot: stays', async () => {
    installMatchMedia(true);
    const { button } = await renderHome();
    // Search held: nothing in the drawer lands (O14c).
    fireEvent.click(button);
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Search open tabs' }),
      {
        target: { value: 'a' },
      }
    );
    fireEvent.click(button);
    expect(drawer()).toBeNull();

    const item = carrySaved();
    await springDrawer();
    moveTo(IN_HEADER);
    releaseAt(IN_HEADER);

    expect(carryEndedAs(item)).toBe('cancelled');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(drawerEl()).not.toHaveAttribute('data-carry-away');
  });

  test('sprung, released inside after a drop that opened: stays', async () => {
    installMatchMedia(true);
    const { button } = await renderHome();
    const item = carrySaved();
    await springDrawer();
    // PREMISE: resting over the pane's header, a release opens a copy.
    expect(opens()).toBe(true);
    releaseAt(ON_RAIL);

    expect(carryEndedAs(item)).toBe('copied');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(drawerEl()).not.toHaveAttribute('data-carry-away');
  });

  test('sprung, Esc: carry ends and the drawer closes', async () => {
    installMatchMedia(true);
    const { button } = await renderHome();
    carrySaved();
    await springDrawer();

    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(currentCarry()).toBeNull();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  test('sprung, gone away, released on the saved side: closes, unmounted', async () => {
    installMatchMedia(true);
    const { button } = await renderHome();
    const item = carrySaved();
    await springDrawer();
    // A slide out would keep it drawn; away, it goes at once.
    holdDrawerMotion();
    moveTo(IN_HEADER);
    moveTo(OFF_RAIL);
    expect(drawerEl()).toHaveAttribute('data-carry-away');

    releaseAt(OFF_RAIL);

    expect(carryEndedAs(item)).toBe('cancelled');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(drawer()).toBeNull();
  });

  test('user-opened, away, brought back by a spring, then Esc: still open', async () => {
    installMatchMedia(true);
    const { button } = await renderHome();
    fireEvent.click(button);
    const open = drawerEl();
    placeDrawer(open);
    carrySaved();
    moveTo(IN_HEADER);
    moveTo(OFF_RAIL);
    expect(open).toHaveAttribute('data-carry-away');
    moveTo(ON_RAIL);
    wait(SPRING_OPEN_MS);
    await flush();
    // PREMISE: brought back.
    expect(open).not.toHaveAttribute('data-carry-away');

    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(currentCarry()).toBeNull();
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  test('sprung, out to the saved side mid-slide, released there: closes', async () => {
    installMatchMedia(true);
    const { button } = await renderHome();
    const endMotion = holdDrawerMotion();
    const item = carrySaved();
    await springDrawer();
    // PREMISE: still sliding in.
    expect(isSettling()).toBe(true);
    moveTo(OFF_RAIL);
    await endMotion();
    moveTo({ x: OFF_RAIL.x, y: OFF_RAIL.y + 10 });

    releaseAt({ x: OFF_RAIL.x, y: OFF_RAIL.y + 10 });

    expect(carryEndedAs(item)).toBe('cancelled');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  // Review Focus 4.
  test('user-opened, gone away under a live carry, back at the end', async () => {
    installMatchMedia(true);
    const { button } = await renderHome();
    fireEvent.click(button);
    const open = drawerEl();
    placeDrawer(open);

    carryLive();
    // Out first, it stays.
    expect(open).not.toHaveAttribute('data-carry-away');
    moveTo(IN_HEADER);
    moveTo(OFF_RAIL);
    expect(open).toHaveAttribute('data-carry-away');
    moveTo(ON_RAIL);
    expect(isTarget()).toBe(false);
    wait(SPRING_OPEN_MS * 2);
    expect(open).toHaveAttribute('data-carry-away');

    releaseAt(OFF_RAIL);

    expect(currentCarry()).toBeNull();
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(drawerEl()).toBe(open);
    expect(open).not.toHaveAttribute('data-carry-away');
  });

  // Review Focus 1.
  test('a release while the sprung drawer settles cancels and the drawer stays', async () => {
    installMatchMedia(true);
    const { button } = await renderHome();
    const endMotion = holdDrawerMotion();
    const item = carrySaved();
    await springDrawer();

    expect(isSettling()).toBe(true);
    // The pointer rests over the pane's header, and the rail still owns it: no +.
    expect(opens()).toBe(false);
    releaseAt(ON_RAIL);

    expect(carryEndedAs(item)).toBe('cancelled');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await endMotion();
    expect(isSettling()).toBe(false);
  });

  test('once the sprung drawer settles, the pane owns the resting pointer with no move', async () => {
    installMatchMedia(true);
    await renderHome();
    const endMotion = holdDrawerMotion();
    carrySaved();
    await springDrawer();
    // PREMISE: still settling, the rail's.
    expect(opens()).toBe(false);

    await endMotion();

    expect(isSettling()).toBe(false);
    expect(opens()).toBe(true);
  });

  // Spec: geometry after the slide-in.
  test('a box read while the drawer slides in is not the one the away rule keeps', async () => {
    installMatchMedia(true);
    await renderHome();
    const endMotion = holdDrawerMotion();
    carrySaved();
    await springDrawer();
    // Mid-slide, the drawer is still off to the right.
    drawerEl().getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 1024, y: 0, width: 380, height: 800 });
    moveTo(IN_HEADER);
    layOutDrawer();
    await endMotion();

    moveTo(IN_HEADER);
    moveTo(OFF_RAIL);

    expect(drawerEl()).toHaveAttribute('data-carry-away');
  });

  // Review Focus 3.
  test('back from away by a second spring, it settles and reroutes', async () => {
    installMatchMedia(true);
    await renderHome();
    carrySaved();
    await springDrawer();
    moveTo(IN_HEADER);
    moveTo(OFF_RAIL);
    expect(drawerEl()).toHaveAttribute('data-carry-away');

    // Its way back is a transition, held here.
    const endMotion = holdDrawerMotion();
    moveTo(ON_RAIL);
    wait(SPRING_OPEN_MS);
    await flush();
    expect(drawerEl()).not.toHaveAttribute('data-carry-away');
    expect(isSettling()).toBe(true);
    expect(opens()).toBe(false);

    await endMotion();

    expect(isSettling()).toBe(false);
    expect(opens()).toBe(true);
  });
});

// KAN-820 F1, F2. While the sprung drawer slides in, its resting box is the rail's: nothing under it takes the carry.
describe('while the sprung drawer slides in', () => {
  // The saved list's pane, under the drawer up to the rail.
  const SAVED_PANE_BOX = DOMRect.fromRect({
    x: 300,
    y: 0,
    width: 680,
    height: 800,
  });
  // Over the drawer's list, off the rail column.
  const IN_DRAWER_LIST = { x: 700, y: 470 };
  // On the saved side, by the saved list's last row.
  const SAVED_SIDE = { x: 400, y: 515 };

  const crossedOut = () =>
    document.documentElement.hasAttribute('data-carry-crossed-out');
  const savedTabs = (store: RenderWithProvidersResult['store']) =>
    store
      .getState()
      .tabContainerDataState.tabGroups.find((g) => g.tabGroupId === 'first')
      ?.windows.flatMap((w) => w.tabs.map((t) => t.tabId));

  // Lays the saved list out under the drawer: window-1 [tab-2, tab-3] from y 400, then the trailing block
  // with the phantom. jsdom does not expand `overflow` into overflowY, which the engine's paneOf reads, so
  // it is set (openNowLayout.test.tsx, O3a).
  function layOutSavedList() {
    const phantom = [
      ...document.querySelectorAll<HTMLElement>('[data-carry-phantom]'),
    ].find((row) => drawer()?.contains(row) !== true);
    let pane = phantom?.parentElement ?? null;
    while (
      pane !== null &&
      !/auto|scroll/.test(getComputedStyle(pane).overflow)
    )
      pane = pane.parentElement;
    if (pane === null) throw new Error('no saved list pane');
    pane.style.overflowY = 'auto';
    pane.getBoundingClientRect = () => SAVED_PANE_BOX;
    const boxes: [selector: string, top: number, height: number][] = [
      ['[data-drop-window-id="window-1"]', 400, 120],
      ['[data-drag-row-id="window-1"]', 400, 120],
      ['[data-drag-row-id="tab:tab-2"]', 440, 40],
      ['[data-drag-row-id="tab-2"]', 440, 40],
      ['[data-drag-row-id="tab:tab-3"]', 480, 40],
      ['[data-drag-row-id="tab-3"]', 480, 40],
      [`[data-drop-window-id="${NEW_LAST_WINDOW}"]`, 520, 40],
      ['[data-drag-row-id="tab:carried:tab-1"]', 524, 32],
      ['[data-drag-row-id="carried:tab-1"]', 524, 32],
    ];
    for (const [selector, top, height] of boxes) {
      const el = pane.querySelector<HTMLElement>(selector);
      if (el === null) throw new Error(`nothing matches ${selector}`);
      el.getBoundingClientRect = () =>
        DOMRect.fromRect({ x: 300, y: top, width: 680, height });
    }
  }

  // The drawer's own list may adopt a crossed carry (KAN-815): its scroller, as layOutSavedList's.
  function letDrawerListAdopt() {
    const scroller = drawerEl().querySelector<HTMLElement>(
      '[data-open-now-scroller]'
    );
    if (scroller === null) throw new Error('no drawer scroller');
    scroller.style.overflowY = 'auto';
  }

  test("a move over it, off the rail, stays the layer's; settled, the pane owns and a release opens", async () => {
    installMatchMedia(true);
    await renderHome({ threeTabs: true });
    const endMotion = holdDrawerMotion();
    const item = carrySaved();
    layOutSavedList();
    await springDrawer();
    letDrawerListAdopt();
    // PREMISE: still sliding in.
    expect(isSettling()).toBe(true);

    moveTo(IN_DRAWER_LIST);
    expect(currentCarry()?.owner).toBe('layer');
    expect(opens()).toBe(false);
    // Inside the drawer: the card is not dimmed as out of it (D3).
    expect(crossedOut()).toBe(false);
    moveTo(IN_HEADER);
    expect(currentCarry()?.owner).toBe('layer');
    expect(opens()).toBe(false);

    await endMotion();
    expect(isSettling()).toBe(false);
    expect(currentCarry()?.owner).toBe('layer');
    expect(opens()).toBe(true);
    releaseAt(IN_HEADER);
    expect(carryEndedAs(item)).toBe('copied');
  });

  test('a release over it, off the rail, cancels: the saved session is unchanged and the drawer stays', async () => {
    installMatchMedia(true);
    const { store, button } = await renderHome({ threeTabs: true });
    const before = savedTabs(store);
    holdDrawerMotion();
    const item = carrySaved();
    layOutSavedList();
    await springDrawer();
    expect(isSettling()).toBe(true);

    moveTo(IN_DRAWER_LIST);
    releaseAt(IN_DRAWER_LIST);

    expect(carryEndedAs(item)).toBe('cancelled');
    expect(savedTabs(store)).toEqual(before);
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  test("the session header's New window target under it takes nothing", async () => {
    installMatchMedia(true);
    const { store } = await renderHome({ threeTabs: true });
    const before = savedTabs(store);
    holdDrawerMotion();
    const item = carrySaved();
    const target = document.querySelector<HTMLElement>(
      '[data-new-window-target="first"]'
    );
    if (target === null) throw new Error('no New window target');
    // Shown by App.css while a carry can make a new window, which jsdom does not load.
    target.style.visibility = 'visible';
    target.getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 660, y: 40, width: 300, height: 40 });
    await springDrawer();
    expect(isSettling()).toBe(true);

    moveTo({ x: 700, y: 60 });
    expect(target).not.toHaveAttribute('data-landing');
    releaseAt({ x: 700, y: 60 });

    expect(carryEndedAs(item)).toBe('cancelled');
    expect(savedTabs(store)).toEqual(before);
  });

  test('sprung, out to the saved side, released before it settles: nothing moves and the drawer closes', async () => {
    installMatchMedia(true);
    const { store, button } = await renderHome({ threeTabs: true });
    const before = savedTabs(store);
    holdDrawerMotion();
    const item = carrySaved();
    layOutSavedList();
    await springDrawer();
    expect(isSettling()).toBe(true);

    moveTo(SAVED_SIDE);
    releaseAt(SAVED_SIDE);

    expect(carryEndedAs(item)).toBe('cancelled');
    expect(savedTabs(store)).toEqual(before);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('folded wide (spec call 1)', () => {
  test('folded wide, the rail springs too', async () => {
    installMatchMedia(false);
    await renderHome({ foldOpenNow: true });
    carrySaved();
    moveTo(ON_RAIL);

    expect(isTarget()).toBe(true);
    wait(SPRING_OPEN_MS - 1);
    expect(drawer()).toBeNull();
    wait(1);
    expect(drawer()).not.toBeNull();
  });
});
