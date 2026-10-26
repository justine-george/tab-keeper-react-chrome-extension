import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import MainContainer from '../../components/MainContainer';
import { OPEN_NOW_RAIL_QUERY } from '../../components/home/opennow/railQuery';
import { SPRING_OPEN_MS } from '../../components/common/springOpen';
import { setDragging } from '../../components/home/rightpane/rowDrag/dropRules';
import { renderWithProviders } from '../setup/renderWithProviders';
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
  currentCarry,
  endCarry,
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

async function renderHome(
  options: { tour?: boolean; foldOpenNow?: boolean } = {}
) {
  const result = await renderWithProviders(<MainContainer />, {
    seed: twoWindows(),
    seedStore: (store) => {
      store.dispatch(
        saveToTabContainerInternal(
          buildSession({ tabGroupId: 'first', title: 'First session' })
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
const isTarget = () => rail().hasAttribute('data-carry-target');
const isSweeping = () => rail().hasAttribute('data-carry-dwell');

// As the engine leaves things at a hand-off: held, kind published, carried, off the rail.
function carrySaved(ref: CarriedRef = TAB) {
  setDragging(true, ref.kind);
  beginDragHold();
  act(() => startCarry(savedItem(ref), CARD, OFF_RAIL.x, OFF_RAIL.y));
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
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

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
    moveTo(ON_RAIL);
    wait(300);
    fireEvent.pointerUp(document, { clientX: ON_RAIL.x, clientY: ON_RAIL.y });

    expect(currentCarry()).toBeNull();
    expect(isTarget()).toBe(false);
    wait(SPRING_OPEN_MS * 2);
    expect(drawer()).toBeNull();
    expect(document.documentElement.hasAttribute('data-carry-opens')).toBe(
      false
    );
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
