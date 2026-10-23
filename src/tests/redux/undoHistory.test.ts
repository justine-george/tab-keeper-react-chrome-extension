import { afterEach, describe, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
  ensureCloudSessionReady: vi.fn(async () => undefined),
}));

import { keepLiveStep, redoStep, undoStep } from '../../redux/undoHistory';
import { sortOpenWindow } from '../../redux/sortOpenWindow';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import {
  replaceState,
  updateTabGroupTitle,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  selectNextStep,
  setPresentStartup,
} from '../../redux/slices/undoRedoSlice';
import { toOpenWindows } from '../../utils/functions/openNow';
import type { OpenWindow } from '../../utils/functions/openNow';
import { moveOpenTab } from '../../utils/functions/openNowMoves';
import type { OpenNowDrop } from '../../utils/functions/openNowMoves';
import type { TabMove } from '../../components/home/rightpane/rowDrag/dropRules';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { setupChromeFake } from '../setup/chrome.fake';
import type { ChromeFakeHandle, ChromeSeed } from '../setup/chrome.fake';
import { makeTestStore } from '../setup/makeStore';
import { newestToast, toastTexts } from '../setup/toasts';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-744 Task 3 (R1-R5, R10-R13, R19): undoStep and redoStep walk saved and
// live steps in one order, and say when a live step can't run.

let handle: ChromeFakeHandle | undefined;

afterEach(() => {
  handle?.restore();
  handle = undefined;
  vi.restoreAllMocks();
});

// W1 [1* b, 2 a, 3 c, 4 a], W2 [21*, 22].
const seed: ChromeSeed = {
  windows: [
    {
      id: 1,
      tabs: [
        { id: 1, url: 'https://b.test/', active: true },
        { id: 2, url: 'https://a.test/' },
        { id: 3, url: 'https://c.test/' },
        { id: 4, url: 'https://a.test/2' },
      ],
    },
    {
      id: 2,
      tabs: [
        { id: 21, url: 'https://x.test/', active: true },
        { id: 22, url: 'https://y.test/' },
      ],
    },
  ],
};

const strip = async (windowId: number) =>
  (await chrome.tabs.query({ windowId }))
    .sort((a, b) => a.index - b.index)
    .map((t) => `${t.id}${t.active ? '*' : ''}`);

async function snapshot(): Promise<OpenWindow[]> {
  const all = await chrome.windows.getAll({
    populate: true,
    windowTypes: ['normal'],
  });
  const groups = chrome.tabGroups ? await chrome.tabGroups.query({}) : null;
  return toOpenWindows(all, groups, null);
}

const TITLE_BEFORE = 'Research';
const TITLE_AFTER = 'Renamed';

// A store with one saved session and the tab group grant.
function setup() {
  const made = makeTestStore();
  const { store } = made;
  store.dispatch(setHasTabGroupsPermission(true));
  const container = buildContainer([
    buildSession({ tabGroupId: 's1', title: TITLE_BEFORE }),
  ]);
  store.dispatch(replaceState(container));
  store.dispatch(setPresentStartup({ tabContainerDataState: container }));
  const title = () =>
    store.getState().tabContainerDataState.tabGroups[0]?.title;
  const past = () => store.getState().undoRedo.past.length;
  const future = () => store.getState().undoRedo.future.length;
  const rename = () =>
    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 's1', editableTitle: TITLE_AFTER })
    );
  // Sorts a window and keeps the sort as a live step.
  const sortAndKeep = async (windowId: number): Promise<OpenNowDrop> => {
    const drop = await sortOpenWindow(windowId, true);
    if (drop === null) throw new Error('PREMISE: the sort moved nothing');
    if (keepLiveStep(store.dispatch, drop) === null) {
      throw new Error('PREMISE: the sort was not kept');
    }
    return drop;
  };
  // Drags a tab and keeps the drag as a live step.
  const dragAndKeep = async (move: TabMove): Promise<OpenNowDrop> => {
    const moved = await moveOpenTab(move, await snapshot(), true);
    if (moved === null) throw new Error('PREMISE: the drag was refused');
    const drop: OpenNowDrop = { kind: 'tab', moved };
    if (keepLiveStep(store.dispatch, drop) === null) {
      throw new Error('PREMISE: the drag was not kept');
    }
    return drop;
  };
  const undoing = () => store.dispatch(undoStep()).unwrap();
  const redoing = () => store.dispatch(redoStep()).unwrap();
  return {
    store,
    title,
    past,
    future,
    rename,
    sortAndKeep,
    dragAndKeep,
    undoing,
    redoing,
  };
}

const dragTo1: TabMove = {
  tabId: '22',
  fromWindowId: '2',
  toWindowId: '1',
  toIndex: 0,
};

const ORIGINAL = ['1*', '2', '3', '4'];
const SORTED = ['1*', '2', '4', '3'];

describe('undoStep and redoStep', () => {
  test('the ticket example walks back and forward (R5)', async () => {
    handle = setupChromeFake(seed);
    const s = setup();

    await s.sortAndKeep(1);
    expect(await strip(1)).toEqual(SORTED);
    s.rename();
    expect(s.title()).toBe(TITLE_AFTER);
    await s.dragAndKeep(dragTo1);
    expect(await strip(1)).toEqual(['22', ...SORTED]);

    expect(await s.undoing()).toBe('live');
    expect(await strip(1)).toEqual(SORTED);
    expect(await strip(2)).toEqual(['21*', '22']);
    expect(s.title()).toBe(TITLE_AFTER);

    expect(await s.undoing()).toBe('saved');
    expect(s.title()).toBe(TITLE_BEFORE);
    expect(await strip(1)).toEqual(SORTED);

    expect(await s.undoing()).toBe('live');
    expect(await strip(1)).toEqual(ORIGINAL);

    expect(await s.redoing()).toBe('live');
    expect(await strip(1)).toEqual(SORTED);

    expect(await s.redoing()).toBe('saved');
    expect(s.title()).toBe(TITLE_AFTER);

    expect(await s.redoing()).toBe('live');
    expect(await strip(1)).toEqual(['22', ...SORTED]);
    expect(await strip(2)).toEqual(['21*']);
  });

  test('with nothing to undo or redo, nothing happens', async () => {
    handle = setupChromeFake(seed);
    const s = setup();

    expect(await s.undoing()).toBe('nothing');
    expect(await s.redoing()).toBe('nothing');
  });

  test('a refused undo shows the sort string, drops the step, and the next press reaches the one before (R10, R11)', async () => {
    handle = setupChromeFake(seed);
    const s = setup();
    s.rename();
    await s.sortAndKeep(1);
    // A new tab in the sorted window: the sort can't be undone.
    handle.browser.openTab(1, { url: 'https://new.test/' });
    const order = await strip(1);
    const toastsBefore = toastTexts(s.store.getState()).length;

    expect(await s.undoing()).toBe('refused');

    expect(newestToast(s.store.getState())?.text).toBe(
      TOAST_MESSAGES.UNDO_REFUSED_SORT
    );
    expect(toastTexts(s.store.getState()).length).toBe(toastsBefore + 1);
    expect(selectNextStep(s.store.getState(), 'undo')).toBe('saved');
    expect(s.title()).toBe(TITLE_AFTER);
    expect(await strip(1)).toEqual(order);

    expect(await s.undoing()).toBe('saved');
    expect(s.title()).toBe(TITLE_BEFORE);
  });

  test('a refused drag undo uses the move string (R10)', async () => {
    handle = setupChromeFake(seed);
    const s = setup();
    await s.dragAndKeep(dragTo1);
    // The dragged tab moved on since.
    await chrome.tabs.move(22, { index: 2 });

    expect(await s.undoing()).toBe('refused');

    expect(newestToast(s.store.getState())?.text).toBe(
      TOAST_MESSAGES.UNDO_REFUSED_MOVE
    );
    expect(selectNextStep(s.store.getState(), 'undo')).toBeNull();
  });

  test('a refused redo uses the Redo string and leaves the rest of the redo list (R10, R11)', async () => {
    handle = setupChromeFake(seed);
    const s = setup();
    await s.sortAndKeep(1);
    await s.dragAndKeep(dragTo1);
    expect(await s.undoing()).toBe('live');
    expect(await s.undoing()).toBe('live');
    expect(s.future()).toBe(2);
    handle.browser.openTab(1, { url: 'https://new.test/' });

    expect(await s.redoing()).toBe('refused');

    expect(newestToast(s.store.getState())?.text).toBe(
      TOAST_MESSAGES.REDO_REFUSED_SORT
    );
    expect(s.future()).toBe(1);
    expect(s.store.getState().undoRedo.future[0]?.liveStep?.drop.kind).toBe(
      'tab'
    );
  });

  test('a refused undo for a closed source window shows its own string, and the next press reaches the step before (R10, R11)', async () => {
    // W3 holds one tab; dragging it away closes the window it came from.
    handle = setupChromeFake({
      windows: [...(seed.windows ?? []), { id: 3, tabs: [{ id: 31 }] }],
    });
    const s = setup();
    s.rename();
    await s.dragAndKeep({
      tabId: '31',
      fromWindowId: '3',
      toWindowId: '1',
      toIndex: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // PREMISE: Chrome closed window 3.
    expect(
      (await chrome.windows.getAll({})).map((window) => window.id)
    ).not.toContain(3);

    expect(await s.undoing()).toBe('refused');

    expect(newestToast(s.store.getState())?.text).toBe(
      TOAST_MESSAGES.UNDO_REFUSED_WINDOW_CLOSED
    );
    expect(selectNextStep(s.store.getState(), 'undo')).toBe('saved');
    expect(await s.undoing()).toBe('saved');
    expect(s.title()).toBe(TITLE_BEFORE);
  });

  test('a refused redo for a closed target window shows its own string, and the next press reaches the saved step after it (R10, R11)', async () => {
    handle = setupChromeFake({
      windows: [...(seed.windows ?? []), { id: 3, tabs: [{ id: 31 }] }],
    });
    const s = setup();
    await s.dragAndKeep({
      tabId: '22',
      fromWindowId: '2',
      toWindowId: '3',
      toIndex: 1,
    });
    s.rename();
    expect(await s.undoing()).toBe('saved');
    expect(await s.undoing()).toBe('live');
    // PREMISE: the drag, then the rename, wait to be redone.
    expect(s.future()).toBe(2);
    handle.browser.closeWindow(3);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await s.redoing()).toBe('refused');

    expect(newestToast(s.store.getState())?.text).toBe(
      TOAST_MESSAGES.REDO_REFUSED_WINDOW_CLOSED
    );
    expect(s.title()).toBe(TITLE_BEFORE);
    expect(s.future()).toBe(1);
    expect(selectNextStep(s.store.getState(), 'redo')).toBe('saved');
    expect(await s.redoing()).toBe('saved');
    expect(s.title()).toBe(TITLE_AFTER);
    expect(s.future()).toBe(0);
  });

  test('a refused drag redo uses the Redo move string (R10)', async () => {
    handle = setupChromeFake(seed);
    const s = setup();
    await s.dragAndKeep(dragTo1);
    expect(await s.undoing()).toBe('live');
    await chrome.tabs.move(22, { index: 0 });

    expect(await s.redoing()).toBe('refused');

    expect(newestToast(s.store.getState())?.text).toBe(
      TOAST_MESSAGES.REDO_REFUSED_MOVE
    );
  });

  test('a step that could not run is dropped without a toast (R12)', async () => {
    handle = setupChromeFake(seed);
    const s = setup();
    s.rename();
    await s.sortAndKeep(1);
    // The grant is gone when the press comes.
    s.store.dispatch(setHasTabGroupsPermission(false));
    const toastsBefore = toastTexts(s.store.getState());
    const pastBefore = s.past();

    expect(await s.undoing()).toBe('failed');

    expect(toastTexts(s.store.getState())).toEqual(toastsBefore);
    expect(s.past()).toBe(pastBefore - 1);
    expect(selectNextStep(s.store.getState(), 'undo')).toBe('saved');
  });

  test('a press while a live step runs is ignored, not queued (R19)', async () => {
    handle = setupChromeFake(seed);
    const s = setup();
    // A saved step below the live one: a queued press would undo it next.
    s.rename();
    await s.dragAndKeep(dragTo1);
    const original: (
      id: number,
      props: chrome.tabs.MoveProperties
    ) => Promise<chrome.tabs.Tab> = chrome.tabs.move;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const move = vi
      .spyOn(chrome.tabs, 'move')
      .mockImplementation((id, props) =>
        gate.then(() =>
          typeof id === 'number'
            ? original(id, props)
            : Promise.reject(new Error('PREMISE: one tab moves at a time'))
        )
      );
    const pastBefore = s.past();

    const first = s.undoing();
    await vi.waitFor(() => expect(move).toHaveBeenCalled());
    expect(await s.undoing()).toBe('busy');
    expect(await s.redoing()).toBe('busy');
    release();

    expect(await first).toBe('live');
    expect(s.past()).toBe(pastBefore - 1);
    expect(s.future()).toBe(1);
    // Nothing was queued behind it: the rename below still stands, and is next.
    expect(await strip(2)).toEqual(['21*', '22']);
    expect(s.title()).toBe(TITLE_AFTER);
    expect(selectNextStep(s.store.getState(), 'undo')).toBe('saved');
  });

  test('a press after a run ends is not busy (R19)', async () => {
    handle = setupChromeFake(seed);
    const s = setup();
    await s.dragAndKeep(dragTo1);
    expect(await s.undoing()).toBe('live');

    expect(await s.redoing()).toBe('live');
  });
});

describe('keepLiveStep', () => {
  test('keeps nothing for a drop that changed no place', async () => {
    handle = setupChromeFake(seed);
    const s = setup();
    const place = { windowId: 1, index: 0, groupId: -1, group: null };
    const stay: OpenNowDrop = {
      kind: 'tab',
      moved: [{ tabId: 1, before: place, after: { ...place } }],
    };
    const before = s.store.getState().undoRedo;

    expect(keepLiveStep(s.store.dispatch, stay)).toBeNull();

    expect(s.store.getState().undoRedo).toEqual(before);
  });

  test('keeps a drop that moved a tab and returns its id', async () => {
    handle = setupChromeFake(seed);
    const s = setup();
    const moved = await moveOpenTab(dragTo1, await snapshot(), true);
    if (moved === null) throw new Error('PREMISE: the drag was refused');

    const id = keepLiveStep(s.store.dispatch, { kind: 'tab', moved });

    expect(id).not.toBeNull();
    expect(s.store.getState().undoRedo.present.liveStep?.id).toBe(id);
  });
});
