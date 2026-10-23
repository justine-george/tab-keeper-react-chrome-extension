import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import MainContainer from '../../components/MainContainer';
import { offerReopen } from '../../redux/reopenOffer';
import { clearReopenFocus } from '../../redux/reopenFocus';
import { sortOpenWindowBySite } from '../../redux/sortOpenWindow';
import { keepLiveStep } from '../../redux/undoHistory';
import {
  selectUndoKeyTarget,
  setHasTabGroupsPermission,
} from '../../redux/slices/globalStateSlice';
import { saveToTabContainerInternal } from '../../redux/slices/tabContainerDataStateSlice';
import { setPresentStartup } from '../../redux/slices/undoRedoSlice';
import { toOpenWindows } from '../../utils/functions/openNow';
import { moveOpenTab } from '../../utils/functions/openNowMoves';
import { closeOpenTab } from '../../utils/functions/reopen';
import { buildSession } from '../fixtures/sessionFixture';
import type { ChromeSeed } from '../setup/chrome.fake';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { RenderWithProvidersResult } from '../setup/renderWithProviders';

// KAN-280 Part E Task 7 (spec O11f, U1), KAN-744. Open now drags and saved
// changes are steps in one history: ⌘Z / Ctrl+Z undoes the newest, ⌘⇧Z /
// Ctrl+Y redoes. A Reopen offer (O8c) is taken first while it came after the
// newest drag (R17); the menu's buttons walk the history and never take it (R15).

const UNDO = 'undoRedo/undo';
const REDO = 'undoRedo/redo';

const url = (name: string) => `https://${name}.test/`;

// W1 holds the page; W2 [21 a, 22 b, 23 c].
// Refused, so Reopen recreates: these tests are about recreate, and with no
// refusal a close now gets `sessions` (KAN-663) and Reopen goes to the worker.
const seed: ChromeSeed = {
  refusedPermissions: ['sessions'],
  windows: [
    {
      id: 1,
      focused: true,
      tabs: [{ id: 11, url: url('home'), active: true }],
    },
    {
      id: 2,
      tabs: [
        { id: 21, url: url('a'), active: true },
        { id: 22, url: url('b') },
        { id: 23, url: url('c') },
      ],
    },
  ],
};

async function snapshot() {
  const all = await chrome.windows.getAll({
    populate: true,
    windowTypes: ['normal'],
  });
  return toOpenWindows(all, null, null);
}

const urlsIn = async (windowId: number) =>
  (await chrome.tabs.query({ windowId }))
    .sort((x, y) => x.index - y.index)
    .map((tab) => tab.url ?? '');

type Store = RenderWithProvidersResult['store'];

// A tab of W2 dropped at toIndex in W2, kept as the Open now hook keeps it.
async function dragInW2(
  store: Store,
  tabId: string,
  toIndex: number
): Promise<void> {
  const moved = await moveOpenTab(
    { tabId, fromWindowId: '2', toWindowId: '2', toIndex },
    await snapshot(),
    false
  );
  if (moved === null) throw new Error('PREMISE: the drop was refused');
  act(() => {
    if (keepLiveStep(store.dispatch, { kind: 'tab', moved }) === null) {
      throw new Error('PREMISE: the drop was not kept');
    }
  });
}

// A: 21 dropped right after 22 (between b and c, while c is open).
async function dragAToTheMiddle(store: Store): Promise<void> {
  const cOpen = (await urlsIn(2)).includes(url('c'));
  await dragInW2(store, '21', 1);
  expect(await urlsIn(2)).toEqual(
    cOpen ? [url('b'), url('a'), url('c')] : [url('b'), url('a')]
  );
}

// c closed from Open now, and its Reopen toast up.
async function closeCWithOffer(store: Store): Promise<void> {
  const w2 = (await snapshot()).find((window) => window.id === 2);
  const c = w2?.tabs.find((tab) => tab.url === url('c'));
  if (!w2 || !c) throw new Error('no tab c');
  const item = await closeOpenTab(w2, c);
  if (!item) throw new Error('close failed');
  await act(async () => {
    await store.dispatch(offerReopen(item));
  });
  expect(offerShows()).toBe(true);
}

// A saved-session change: an undoable step in Redux history. History starts
// where the app starts it, from the stored sessions (App's startup does
// this): this file's import order leaves the slice's own initial `present`
// without a container (the KAN-137 cycle, sliceImportCycle.test.tsx), and
// undoing back to it would throw.
async function saveASession(store: Store): Promise<void> {
  await act(async () => {
    store.dispatch(
      setPresentStartup({
        tabContainerDataState: store.getState().tabContainerDataState,
      })
    );
    store.dispatch(
      saveToTabContainerInternal(
        buildSession({ tabGroupId: 'saved', title: 'Saved' })
      )
    );
  });
  expect(store.getState().undoRedo.past.length).toBeGreaterThan(0);
}

function offerShows(): boolean {
  return (
    within(screen.getByRole('status')).queryByRole('button', {
      name: 'Reopen',
    }) !== null
  );
}

function press(chord: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...chord,
  });
  act(() => {
    document.body.dispatchEvent(event);
  });
  return event;
}

function release(key: string): void {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key })
    );
  });
}

// A second saved-session change, one more step above the first.
async function saveAnotherSession(store: Store): Promise<void> {
  await act(async () => {
    store.dispatch(
      saveToTabContainerInternal(
        buildSession({ tabGroupId: 'saved2', title: 'Saved 2' })
      )
    );
  });
}

// The menu's Undo or Redo, not a toast's chip of the same name.
function menuButton(name: 'Undo' | 'Redo'): HTMLElement {
  const button = screen
    .getAllByRole('button', { name })
    .find((b) => b.closest('[role="status"]') === null);
  if (button === undefined) throw new Error(`PREMISE: no menu ${name}`);
  return button;
}

const undoRedoIn = (seen: string[]) =>
  seen.filter((type) => type === UNDO || type === REDO);

const aIsBack = () =>
  waitFor(async () => {
    expect(await urlsIn(2)).toEqual([url('a'), url('b'), url('c')]);
  });

const aIsInTheMiddle = () =>
  waitFor(async () => {
    expect(await urlsIn(2)).toEqual([url('b'), url('a'), url('c')]);
  });

// Lets any undo a press started settle, so "nothing moved" is not read
// before a move that is still on its way.
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

beforeEach(() => {
  // Open now, and with it every drag, lives in the tab view.
  history.replaceState(null, '', '?view=tab');
});

afterEach(() => {
  history.replaceState(null, '', '/');
  clearReopenFocus();
});

describe('⌘Z after an Open now drag', () => {
  test.each([
    ['⌘Z', { key: 'z', metaKey: true }],
    ['Ctrl+Z', { key: 'z', ctrlKey: true }],
  ])('%s moves the tab back, and undoes no saved change', async (_n, chord) => {
    const { store, seen } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await saveASession(store);
    await dragAToTheMiddle(store);
    const before = seen.length;

    const event = press(chord);

    await aIsBack();
    expect(event.defaultPrevented).toBe(true);
    expect(undoRedoIn(seen.slice(before))).toEqual([]);
  });

  test('a second ⌘Z undoes the saved change before the drag', async () => {
    const { store, seen } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await saveASession(store);
    await dragAToTheMiddle(store);
    press({ key: 'z', metaKey: true });
    await aIsBack();
    const before = seen.length;

    press({ key: 'z', metaKey: true });
    await settle();

    expect(undoRedoIn(seen.slice(before))).toEqual([UNDO]);
    expect(await urlsIn(2)).toEqual([url('a'), url('b'), url('c')]);
  });

  test('a held key: its repeats after the drag undo undo nothing', async () => {
    const { store, seen } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await saveASession(store);
    await dragAToTheMiddle(store);
    press({ key: 'z', metaKey: true });
    await aIsBack();
    const before = seen.length;

    const repeat = press({ key: 'z', metaKey: true, repeat: true });

    expect(undoRedoIn(seen.slice(before))).toEqual([]);
    expect(repeat.defaultPrevented).toBe(true);
  });

  // KAN-744 R2, R7.
  test.each([
    ['⌘⇧Z', { key: 'Z', metaKey: true, shiftKey: true }],
    ['Ctrl+Y', { key: 'y', ctrlKey: true }],
  ])('%s redoes a drag', async (_n, chord) => {
    const { store, seen } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await dragAToTheMiddle(store);
    press({ key: 'z', metaKey: true });
    await aIsBack();
    const before = seen.length;

    const event = press(chord);

    await aIsInTheMiddle();
    expect(event.defaultPrevented).toBe(true);
    expect(undoRedoIn(seen.slice(before))).toEqual([]);
  });
});

// KAN-744 R20. A held key walks saved steps, and never a live step or an offer.
describe('a held undo key (KAN-744 R20)', () => {
  test('a held ⌘Z walks saved steps and stops at a live one', async () => {
    const { store, seen } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await dragAToTheMiddle(store);
    await saveASession(store);
    await saveAnotherSession(store);
    const before = seen.length;

    press({ key: 'z', metaKey: true });
    await settle();
    press({ key: 'z', metaKey: true, repeat: true });
    await settle();
    expect(undoRedoIn(seen.slice(before))).toEqual([UNDO, UNDO]);

    const dropped = press({ key: 'z', metaKey: true, repeat: true });
    press({ key: 'z', metaKey: true, repeat: true });
    await settle();

    expect(dropped.defaultPrevented).toBe(true);
    expect(undoRedoIn(seen.slice(before))).toEqual([UNDO, UNDO]);
    expect(await urlsIn(2)).toEqual([url('b'), url('a'), url('c')]);
  });

  test.each([
    ['⌘⇧Z', { key: 'Z', metaKey: true, shiftKey: true }, 'z'],
    ['Ctrl+Y', { key: 'y', ctrlKey: true }, 'y'],
  ])('a held %s stops at a live one', async (_n, chord, letter) => {
    const { store, seen } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await saveASession(store);
    await dragAToTheMiddle(store);
    press({ key: 'z', metaKey: true });
    await aIsBack();
    press({ key: 'z', metaKey: true });
    await settle();
    release('z');
    const before = seen.length;

    press(chord);
    await settle();
    expect(undoRedoIn(seen.slice(before))).toEqual([REDO]);
    const dropped = press({ ...chord, repeat: true });
    await settle();

    expect(dropped.defaultPrevented).toBe(true);
    expect(undoRedoIn(seen.slice(before))).toEqual([REDO]);
    expect(await urlsIn(2)).toEqual([url('a'), url('b'), url('c')]);

    // The hold ends on the letter's keyup, so a fresh press redoes the drag.
    release(letter);
    press(chord);
    await aIsInTheMiddle();
  });

  test('repeats after a refused press undo nothing', async () => {
    const { store, seen } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await saveASession(store);
    await dragAToTheMiddle(store);
    // Chrome's tabs change under the drag, so undoing it is refused.
    await chrome.tabs.move(21, { index: 0 });
    const before = seen.length;

    press({ key: 'z', metaKey: true });
    await settle();
    expect(undoRedoIn(seen.slice(before))).toEqual([]);
    expect(store.getState().undoRedo.present.liveStep).toBeUndefined();

    const repeat = press({ key: 'z', metaKey: true, repeat: true });
    await settle();

    expect(repeat.defaultPrevented).toBe(true);
    expect(undoRedoIn(seen.slice(before))).toEqual([]);

    // CONTROL: the saved change is there to undo once the key is let go.
    release('z');
    press({ key: 'z', metaKey: true });
    await settle();
    expect(undoRedoIn(seen.slice(before))).toEqual([UNDO]);
  });

  test('a repeat never takes an offer that appeared while the key was held', async () => {
    const { store, seen } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await saveASession(store);
    await saveAnotherSession(store);
    // PREMISE: the first press has a saved step to undo, and no offer to take.
    expect(selectUndoKeyTarget(store.getState())).toEqual({ kind: 'step' });
    press({ key: 'z', metaKey: true });
    await settle();
    // A tab closes while the key is held: its Reopen offer is now what a repeat would take.
    await closeCWithOffer(store);
    const target = selectUndoKeyTarget(store.getState());
    expect(target?.kind).toBe('offer');
    const before = seen.length;

    const repeat = press({ key: 'z', metaKey: true, repeat: true });
    press({ key: 'z', metaKey: true, repeat: true });
    await settle();

    expect(repeat.defaultPrevented).toBe(true);
    expect(offerShows()).toBe(true);
    expect(await urlsIn(2)).toEqual([url('a'), url('b')]);
    // The hold is on: the saved step left under it is not undone either.
    expect(undoRedoIn(seen.slice(before))).toEqual([]);

    // CONTROL: a fresh press takes the offer.
    release('z');
    press({ key: 'z', metaKey: true });
    await waitFor(async () => {
      expect(await urlsIn(2)).toEqual([url('a'), url('b'), url('c')]);
    });
  });

  test('a result that lands after a fresh press does not hold that press', async () => {
    const { store, seen } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await saveASession(store);
    await dragAToTheMiddle(store);
    // Chrome answers the first undo only when told to.
    const realMove = chrome.tabs.move.bind(chrome.tabs);
    let answer: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      answer = resolve;
    });
    vi.spyOn(chrome.tabs, 'move').mockImplementationOnce(async (...args) => {
      await gate;
      return realMove(...args);
    });
    press({ key: 'z', metaKey: true });
    // A fresh press while the first still runs: it is ignored as busy.
    release('z');
    press({ key: 'z', metaKey: true });
    await act(async () => {
      answer();
    });
    await aIsBack();
    await settle();
    const before = seen.length;

    // The second press is the one held now; the first's result must not hold it.
    press({ key: 'z', metaKey: true, repeat: true });
    await settle();

    expect(undoRedoIn(seen.slice(before))).toEqual([UNDO]);
  });

  test('a fresh press after keyup undoes the live step', async () => {
    const { store, seen } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await dragAToTheMiddle(store);
    await saveASession(store);
    press({ key: 'z', metaKey: true });
    await settle();
    press({ key: 'z', metaKey: true, repeat: true });
    await settle();
    expect(await urlsIn(2)).toEqual([url('b'), url('a'), url('c')]);

    release('z');
    press({ key: 'z', metaKey: true });

    await aIsBack();
    expect(seen.filter((type) => type === UNDO)).toHaveLength(1);
  });
});

test("with the tabGroups grant, ⌘Z gives a lone tab's removed group back its look (settled A)", async () => {
  const { chrome: fake, store } = await renderWithProviders(<MainContainer />, {
    seed: {
      grantedPermissions: ['tabGroups'],
      windows: [
        { id: 1, tabs: [{ id: 11, url: url('home'), active: true }] },
        {
          id: 2,
          tabs: [
            { id: 21, url: url('a'), active: true },
            { id: 22, url: url('b'), groupId: 7 },
          ],
        },
      ],
      tabGroups: [{ id: 7, windowId: 2, title: 'Solo', color: 'red' }],
    },
    seedStore: (store) => store.dispatch(setHasTabGroupsPermission(true)),
  });
  const all = await chrome.windows.getAll({
    populate: true,
    windowTypes: ['normal'],
  });
  const moved = await moveOpenTab(
    { tabId: '22', fromWindowId: '2', toWindowId: '1', toIndex: 1 },
    toOpenWindows(all, await chrome.tabGroups.query({}), null),
    true
  );
  if (moved === null) throw new Error('PREMISE: the drop was refused');
  act(() => {
    keepLiveStep(store.dispatch, { kind: 'tab', moved });
  });
  // PREMISE: Chrome removed the group.
  expect(fake.groupState(7)).toBeUndefined();

  press({ key: 'z', metaKey: true });

  await waitFor(async () => {
    const tab = await chrome.tabs.get(22);
    expect([tab.windowId, tab.index]).toEqual([2, 1]);
    expect(fake.groupState(tab.groupId)).toMatchObject({
      title: 'Solo',
      color: 'red',
    });
  });
});

describe('a saved-session change and a drag: one history (KAN-744)', () => {
  // R2. Was "the drag stays": the drag is now a step under the change.
  test('a change after the drag: ⌘Z undoes the change, and a second ⌘Z the drag', async () => {
    const { store, seen } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await dragAToTheMiddle(store);
    await saveASession(store);
    const before = seen.length;

    press({ key: 'z', metaKey: true });
    await settle();

    expect(undoRedoIn(seen.slice(before))).toEqual([UNDO]);
    expect(await urlsIn(2)).toEqual([url('b'), url('a'), url('c')]);

    press({ key: 'z', metaKey: true });

    await aIsBack();
    expect(undoRedoIn(seen.slice(before))).toEqual([UNDO]);
  });

  // R3. Was "a redo step is no new change": a drag is a new step, so it clears the redo.
  test('a drag after an undo clears the redo: ⌘⇧Z redoes nothing, and ⌘Z undoes the drag', async () => {
    const { store, seen } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await saveASession(store);
    press({ key: 'z', metaKey: true });
    // PREMISE: the save is undone, and could be redone.
    expect(store.getState().undoRedo.future).toHaveLength(1);
    await dragAToTheMiddle(store);
    expect(store.getState().undoRedo.future).toEqual([]);
    const before = seen.length;

    press({ key: 'Z', metaKey: true, shiftKey: true });
    await settle();

    expect(undoRedoIn(seen.slice(before))).toEqual([]);
    expect(await urlsIn(2)).toEqual([url('b'), url('a'), url('c')]);

    press({ key: 'z', metaKey: true });

    await aIsBack();
    expect(undoRedoIn(seen.slice(before))).toEqual([]);
  });

  // R2. Was "a drag has no redo (ledger R5)": ⌘⇧Z redoes the step undone last, the drag.
  test('⌘⇧Z after the drag’s undo redoes the drag, not the saved change', async () => {
    const { store, seen } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await saveASession(store);
    await dragAToTheMiddle(store);
    press({ key: 'z', metaKey: true });
    await aIsBack();
    const before = seen.length;

    press({ key: 'Z', metaKey: true, shiftKey: true });

    await aIsInTheMiddle();
    expect(undoRedoIn(seen.slice(before))).toEqual([]);
  });
});

describe('a Reopen offer and a drag: the later one wins', () => {
  test('an offer after the drag: ⌘Z takes the offer, and the drag stays', async () => {
    const { store, seen } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await dragAToTheMiddle(store);
    await closeCWithOffer(store);
    const before = seen.length;

    press({ key: 'z', metaKey: true });

    await waitFor(async () => {
      expect(await urlsIn(2)).toEqual([url('b'), url('a'), url('c')]);
    });
    expect(offerShows()).toBe(false);
    expect(undoRedoIn(seen.slice(before))).toEqual([]);
  });

  test('a drag after the offer: ⌘Z undoes the drag and leaves the offer; a second ⌘Z takes it', async () => {
    const { store, seen } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await closeCWithOffer(store);
    await dragAToTheMiddle(store);
    const before = seen.length;

    press({ key: 'z', metaKey: true });

    await waitFor(async () => {
      expect(await urlsIn(2)).toEqual([url('a'), url('b')]);
    });
    expect(offerShows()).toBe(true);
    expect(undoRedoIn(seen.slice(before))).toEqual([]);

    press({ key: 'z', metaKey: true });

    await waitFor(async () => {
      expect(await urlsIn(2)).toEqual([url('a'), url('b'), url('c')]);
    });
    expect(undoRedoIn(seen.slice(before))).toEqual([]);
  });
});

describe('a Reopen offer between two drags (KAN-744 R17)', () => {
  test('an offer between two drags: ⌘Z takes the newer drag, then the offer, then the older drag', async () => {
    const { store, seen } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await dragAToTheMiddle(store);
    await closeCWithOffer(store);
    // The newer drag: a back to the front of [b, a].
    await dragInW2(store, '21', 0);
    expect(await urlsIn(2)).toEqual([url('a'), url('b')]);
    const before = seen.length;

    press({ key: 'z', metaKey: true });

    await waitFor(async () => {
      expect(await urlsIn(2)).toEqual([url('b'), url('a')]);
    });
    expect(offerShows()).toBe(true);

    press({ key: 'z', metaKey: true });

    await aIsInTheMiddle();
    expect(offerShows()).toBe(false);

    press({ key: 'z', metaKey: true });

    await aIsBack();
    expect(undoRedoIn(seen.slice(before))).toEqual([]);
  });
});

describe('a Reopen offer and a drag under a saved change (KAN-744 R17)', () => {
  test('offer, drag, rename: ⌘Z undoes the rename, then the drag, then takes the offer', async () => {
    const { store, seen } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await closeCWithOffer(store);
    await dragAToTheMiddle(store);
    await saveASession(store);
    // PREMISE: the save announced nothing, so the offer still keeps the key.
    expect(
      store.getState().globalState.toasts.find((t) => t.reopenOffer !== null)
        ?.reopenOffer?.keepsUndoKey
    ).toBe(true);
    const before = seen.length;

    press({ key: 'z', metaKey: true });
    await settle();

    expect(undoRedoIn(seen.slice(before))).toEqual([UNDO]);
    expect(await urlsIn(2)).toEqual([url('b'), url('a')]);
    expect(offerShows()).toBe(true);

    press({ key: 'z', metaKey: true });

    await waitFor(async () => {
      expect(await urlsIn(2)).toEqual([url('a'), url('b')]);
    });
    expect(offerShows()).toBe(true);

    press({ key: 'z', metaKey: true });

    await aIsBack();
    expect(offerShows()).toBe(false);
    expect(undoRedoIn(seen.slice(before))).toEqual([UNDO]);
  });

  // CONTROL: with no drag, an offer and an unannounced saved change after it keep today's order.
  test('offer, then a saved change that announces nothing: ⌘Z takes the offer first', async () => {
    const { store, seen } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await closeCWithOffer(store);
    await saveASession(store);
    const before = seen.length;

    press({ key: 'z', metaKey: true });

    await waitFor(async () => {
      expect(await urlsIn(2)).toEqual([url('a'), url('b'), url('c')]);
    });
    expect(offerShows()).toBe(false);
    expect(undoRedoIn(seen.slice(before))).toEqual([]);
  });
});

describe('the menu Undo and Redo (KAN-744 R15)', () => {
  test('the menu Undo and Redo buttons walk a drag', async () => {
    const user = userEvent.setup();
    const { store, seen } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await dragAToTheMiddle(store);
    const before = seen.length;

    await user.click(menuButton('Undo'));

    await aIsBack();

    await user.click(menuButton('Redo'));

    await aIsInTheMiddle();
    expect(undoRedoIn(seen.slice(before))).toEqual([]);
  });

  test('the menu Undo never takes an offer', async () => {
    const user = userEvent.setup();
    const { store } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await dragAToTheMiddle(store);
    await closeCWithOffer(store);

    await user.click(menuButton('Undo'));

    // The drag is undone in [b, a]; c stays closed, its offer still up.
    await waitFor(async () => {
      expect(await urlsIn(2)).toEqual([url('a'), url('b')]);
    });
    expect(offerShows()).toBe(true);
  });
});

describe('⌘Z after an Open now sort (KAN-694)', () => {
  test('puts the tabs back and closes the "Sorted the tabs by site." toast', async () => {
    const { store } = await renderWithProviders(<MainContainer />, {
      seed: {
        grantedPermissions: ['tabGroups'],
        windows: [
          { id: 1, tabs: [{ id: 11, url: url('home'), active: true }] },
          {
            id: 2,
            tabs: [
              { id: 21, url: url('a'), active: true },
              { id: 22, url: url('b') },
              { id: 23, url: url('a') },
            ],
          },
        ],
      },
      seedStore: (s) => s.dispatch(setHasTabGroupsPermission(true)),
    });
    await act(async () => {
      await store.dispatch(sortOpenWindowBySite(2));
    });
    const ids = async () =>
      (await chrome.tabs.query({ windowId: 2 }))
        .sort((x, y) => x.index - y.index)
        .map((tab) => tab.id);
    // PREMISE: the sort moved b to the end, and its toast is up.
    expect(await ids()).toEqual([21, 23, 22]);
    expect(await screen.findByText('Sorted the tabs by site.')).toBeVisible();

    press({ key: 'z', metaKey: true });

    await waitFor(async () => expect(await ids()).toEqual([21, 22, 23]));
    // The toast leaves with a short fade.
    await waitFor(() =>
      expect(screen.queryByText('Sorted the tabs by site.')).toBeNull()
    );
  });
});
