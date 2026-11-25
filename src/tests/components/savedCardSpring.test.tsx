import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import MainContainer from '../../components/MainContainer';
import { OPEN_NOW_RAIL_QUERY } from '../../components/home/opennow/railQuery';
import { SPRING_OPEN_MS } from '../../components/common/springOpen';
import { setDragging } from '../../components/home/rightpane/rowDrag/dropRules';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';
import {
  saveToTabContainerInternal,
  selectTabContainer,
  type CarriedRef,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setFoldSavedSessionInTabView } from '../../redux/slices/settingsDataStateSlice';
import { buildSession } from '../fixtures/sessionFixture';
import { live } from '../fixtures/liveSnapshotFixture';
import {
  carryEndedAs,
  currentCarry,
  endCarry,
  setLiveCarrySaves,
  startCarry,
  type CarryCard,
} from '../../redux/carry';
import { liveItem, savedItem } from '../../redux/carriedItem';
import { showSession } from '../../redux/showSession';
import { beginDragHold, endDragHold } from '../../redux/dragHold';
import { dragKindOf } from '../setup/carryKind';

// KAN-1006 (his yes). Folded, a live carry resting SPRING_OPEN_MS on the
// Saved session card peeks the saved session, as resting on its row does; the
// peek folds back when the carry ends. jsdom lays nothing out: the card's
// column is stubbed at x 300..352.

const SLOT_BOX = DOMRect.fromRect({ x: 300, y: 0, width: 52, height: 800 });
const ON_CARD = { x: 320, y: 300 };
const OFF_CARD = { x: 700, y: 300 };
const REDUCED = '(prefers-reduced-motion: reduce)';
const CARD: CarryCard = { kind: 'tab', title: 'Example', faviconUrl: '' };
const TAB: CarriedRef = {
  kind: 'tab',
  tabGroupId: 'first',
  windowId: 'window-1',
  tabId: 'tab-1',
};

const oneWindow = (): ChromeSeed => ({
  windows: [
    {
      id: 1,
      focused: true,
      tabs: [{ title: 'A', url: 'https://a.test/', active: true }],
    },
  ],
});

function installMatchMedia(reducedMotion = false) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      new FakeMediaQueryList(
        query,
        query === REDUCED
          ? reducedMotion
          : query === OPEN_NOW_RAIL_QUERY && false
      )
  );
}

async function renderFolded(reducedMotion = false) {
  installMatchMedia(reducedMotion);
  const result = await renderWithProviders(<MainContainer />, {
    seed: oneWindow(),
    seedStore: (store) => {
      store.dispatch(
        saveToTabContainerInternal(
          buildSession({ tabGroupId: 'first', title: 'First session' })
        )
      );
      store.dispatch(selectTabContainer('first'));
      store.dispatch(setFoldSavedSessionInTabView(true));
    },
  });
  await screen.findByRole('button', { name: 'Show the saved session' });
  // Timers are faked after the render: i18n's init must settle first.
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
  });
  slot().getBoundingClientRect = () => SLOT_BOX;
  return result;
}

function slot(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-saved-card-slot]');
  if (el === null) throw new Error('no card slot');
  return el;
}
const card = () =>
  document.querySelector<HTMLElement>('[data-saved-session-card]');
const isTarget = () => card()?.hasAttribute('data-carry-target') === true;
const isSweeping = () => card()?.hasAttribute('data-carry-dwell') === true;
const badge = () =>
  document.querySelector('[data-carry-card] [data-carry-card-badge]');

// As the engine leaves things at a hand-off: held, kind published, carried, off the card.
function carryLive() {
  setDragging(true, 'tab');
  beginDragHold();
  const item = liveItem({
    pick: { kind: 'tab', windowId: 'live-w', tabId: 'l1' },
    window: live(),
    chromeWindowId: 7,
  });
  act(() => startCarry(item, CARD, OFF_CARD.x, OFF_CARD.y));
  return item;
}
function carrySaved() {
  setDragging(true, dragKindOf(TAB));
  beginDragHold();
  act(() => startCarry(savedItem(TAB), CARD, OFF_CARD.x, OFF_CARD.y));
}

const moveTo = ({ x, y }: { x: number; y: number }) =>
  fireEvent.pointerMove(document, { clientX: x, clientY: y });
const releaseAt = ({ x, y }: { x: number; y: number }) =>
  fireEvent.pointerUp(document, { clientX: x, clientY: y });
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

// The pane motions run from here on, as "<kind> <direction>" (test-only stub:
// jsdom has no view transitions). As in Chrome, the update runs later, not
// inside startViewTransition: here on the next timer.
function recordPaneMotions() {
  const runs: string[] = [];
  document.startViewTransition = ((update: () => void) => {
    const root = document.documentElement;
    runs.push(`${root.dataset.paneMove} ${root.dataset.paneMoveDir}`);
    setTimeout(update, 0);
    return { finished: new Promise<void>(() => {}) };
  }) as unknown as typeof document.startViewTransition;
  return () => runs;
}

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '?view=tab');
});

afterEach(() => {
  act(() => endCarry('cancelled'));
  delete (document as { startViewTransition?: unknown }).startViewTransition;
  delete document.documentElement.dataset.paneMove;
  delete document.documentElement.dataset.paneMoveDir;
  endDragHold();
  document.documentElement.removeAttribute('data-dragging');
  vi.useRealTimers();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
  localStorage.clear();
});

describe('a live carry on the folded Saved session card', () => {
  test('is its target, sweeping, and peeks the saved session after SPRING_OPEN_MS; the stored fold stays', async () => {
    const { store } = await renderFolded();
    carryLive();
    // CONTROL: off the card, no target.
    expect(isTarget()).toBe(false);

    moveTo(ON_CARD);
    expect(isTarget()).toBe(true);
    expect(isSweeping()).toBe(true);
    wait(SPRING_OPEN_MS - 1);
    expect(store.getState().globalState.isPeekingSavedSession).toBe(false);

    wait(1);
    expect(store.getState().globalState.isPeekingSavedSession).toBe(true);
    expect(store.getState().settingsDataState.foldSavedSessionInTabView).toBe(
      true
    );
    // The peek lays the page out with the detail, not the card.
    expect(card()).toBeNull();
    expect(currentCarry()).not.toBeNull();
  });

  test('moving off before SPRING_OPEN_MS clears the target and its timer', async () => {
    const { store } = await renderFolded();
    carryLive();
    moveTo(ON_CARD);
    wait(SPRING_OPEN_MS - 100);
    moveTo(OFF_CARD);
    expect(isTarget()).toBe(false);
    wait(SPRING_OPEN_MS);
    expect(store.getState().globalState.isPeekingSavedSession).toBe(false);
  });

  test('reduced motion: no sweep, still peeks after the wait', async () => {
    const { store } = await renderFolded(true);
    carryLive();
    moveTo(ON_CARD);
    expect(isTarget()).toBe(true);
    expect(isSweeping()).toBe(false);
    wait(SPRING_OPEN_MS);
    expect(store.getState().globalState.isPeekingSavedSession).toBe(true);
  });

  test('wears no +: a release there saves nothing', async () => {
    await renderFolded();
    carryLive();
    act(() => setLiveCarrySaves(true));
    // PREMISE: the + shows while something would save it.
    expect(badge()).not.toBeNull();
    moveTo(ON_CARD);
    expect(badge()).toBeNull();
  });

  test('a release on the card cancels it, and nothing peeks', async () => {
    const { store } = await renderFolded();
    const before = store.getState().tabContainerDataState.tabGroups;
    const item = carryLive();
    moveTo(ON_CARD);
    releaseAt(ON_CARD);
    expect(currentCarry()).toBeNull();
    expect(carryEndedAs(item)).toBe('cancelled');
    expect(store.getState().tabContainerDataState.tabGroups).toBe(before);
    wait(SPRING_OPEN_MS);
    expect(store.getState().globalState.isPeekingSavedSession).toBe(false);
  });

  test('a saved carry gets no target there and never peeks', async () => {
    const { store } = await renderFolded();
    carrySaved();
    moveTo(ON_CARD);
    expect(isTarget()).toBe(false);
    wait(SPRING_OPEN_MS);
    expect(store.getState().globalState.isPeekingSavedSession).toBe(false);
  });
});

describe('the peek it opened folds back when the carry ends', () => {
  async function springPeek() {
    const r = await renderFolded();
    const kinds = recordPaneMotions();
    carryLive();
    moveTo(ON_CARD);
    wait(SPRING_OPEN_MS);
    // PREMISE: the peek slides in, its update a timer later.
    expect(r.store.getState().globalState.isPeekingSavedSession).toBe(false);
    wait(1);
    expect(r.store.getState().globalState.isPeekingSavedSession).toBe(true);
    expect(kinds()).toEqual(['saved unfold']);
    return { ...r, kinds };
  }

  test('Esc: folded again on the frame after, the card back', async () => {
    const { store } = await springPeek();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(currentCarry()).toBeNull();
    wait(16);
    expect(store.getState().globalState.isPeekingSavedSession).toBe(false);
    expect(card()).not.toBeNull();
    expect(store.getState().settingsDataState.foldSavedSessionInTabView).toBe(
      true
    );
  });

  test('a release nothing takes: folded again', async () => {
    const { store } = await springPeek();
    releaseAt(OFF_CARD);
    wait(16);
    expect(store.getState().globalState.isPeekingSavedSession).toBe(false);
  });

  test('a drop that committed: folded again', async () => {
    const { store } = await springPeek();
    act(() => endCarry('committed'));
    wait(16);
    expect(store.getState().globalState.isPeekingSavedSession).toBe(false);
  });

  test('Esc slides it back as a fold', async () => {
    const { kinds } = await springPeek();
    fireEvent.keyDown(window, { key: 'Escape' });
    wait(16);
    expect(kinds()).toEqual(['saved unfold', 'saved fold']);
  });

  test('an unfold stored meanwhile is not undone, and the peek ends without a slide', async () => {
    const { store, kinds } = await springPeek();
    act(() => {
      store.dispatch(setFoldSavedSessionInTabView(false));
    });
    act(() => endCarry('cancelled'));
    wait(16);
    expect(store.getState().settingsDataState.foldSavedSessionInTabView).toBe(
      false
    );
    // Ended, so a later fold from another page is not held open (KAN-280 O5).
    expect(store.getState().globalState.isPeekingSavedSession).toBe(false);
    expect(kinds()).toEqual(['saved unfold']);
    expect(card()).toBeNull();
  });

  test('CONTROL: a peek a row rest opened (not the card) stays after the carry', async () => {
    const { store } = await renderFolded();
    carryLive();
    act(() => {
      store.dispatch(showSession('first'));
    });
    expect(store.getState().globalState.isPeekingSavedSession).toBe(true);
    act(() => endCarry('cancelled'));
    wait(16);
    expect(store.getState().globalState.isPeekingSavedSession).toBe(true);
  });
});
