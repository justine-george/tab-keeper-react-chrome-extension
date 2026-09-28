import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';

import MainContainer from '../../components/MainContainer';
import { offerReopen } from '../../redux/reopenOffer';
import {
  noteTabKeeperAction,
  storeOpenNowDrop,
} from '../../redux/openNowMoveUndo';
import { clearReopenFocus } from '../../redux/reopenFocus';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import { saveToTabContainerInternal } from '../../redux/slices/tabContainerDataStateSlice';
import { setPresentStartup } from '../../redux/slices/undoRedoSlice';
import { toOpenWindows } from '../../utils/functions/openNow';
import { moveOpenTab } from '../../utils/functions/openNowMoves';
import { closeOpenTab } from '../../utils/functions/reopen';
import { buildSession } from '../fixtures/sessionFixture';
import type { ChromeSeed } from '../setup/chrome.fake';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { RenderWithProvidersResult } from '../setup/renderWithProviders';

// KAN-280 Part E Task 7 (spec O11f, U1; ledger R5, R23). ⌘Z / Ctrl+Z undoes
// the most recent Tab Keeper action: an Open now drag, a close whose Reopen
// offer shows (O8c), or a saved-session change. A drag's undo lasts until
// the next such action; a stale one does nothing and does not fall through.

const UNDO = 'undoRedo/undo';
const REDO = 'undoRedo/redo';

const url = (name: string) => `https://${name}.test/`;

// W1 holds the page; W2 [21 a, 22 b, 23 c].
const seed: ChromeSeed = {
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

// A: 21 dropped right after 22 (between b and c, while c is open), kept as
// the Open now hook keeps it.
async function dragAToTheMiddle(): Promise<void> {
  const cOpen = (await urlsIn(2)).includes(url('c'));
  const moved = await moveOpenTab(
    { tabId: '21', fromWindowId: '2', toWindowId: '2', toIndex: 1 },
    await snapshot(),
    false
  );
  if (moved === null) throw new Error('PREMISE: the drop was refused');
  storeOpenNowDrop({ kind: 'tab', moved });
  expect(await urlsIn(2)).toEqual(
    cOpen ? [url('b'), url('a'), url('c')] : [url('b'), url('a')]
  );
}

// c closed from Open now, and its Reopen toast up.
async function closeCWithOffer(
  store: RenderWithProvidersResult['store']
): Promise<void> {
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
async function saveASession(
  store: RenderWithProvidersResult['store']
): Promise<void> {
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

const undoRedoIn = (seen: string[]) =>
  seen.filter((type) => type === UNDO || type === REDO);

const aIsBack = () =>
  waitFor(async () => {
    expect(await urlsIn(2)).toEqual([url('a'), url('b'), url('c')]);
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
  // A kept drop is module state: a later action retires it.
  noteTabKeeperAction();
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
    await dragAToTheMiddle();
    const before = seen.length;

    const event = press(chord);

    await aIsBack();
    expect(event.defaultPrevented).toBe(true);
    expect(undoRedoIn(seen.slice(before))).toEqual([]);
  });

  test('CONTROL: in the popup, with no drag, ⌘Z undoes the saved change as before', async () => {
    history.replaceState(null, '', '/');
    const { store, seen } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await saveASession(store);
    const before = seen.length;

    press({ key: 'z', metaKey: true });

    expect(undoRedoIn(seen.slice(before))).toEqual([UNDO]);
  });

  test('a second ⌘Z undoes the saved change before the drag', async () => {
    const { store, seen } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await saveASession(store);
    await dragAToTheMiddle();
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
    await dragAToTheMiddle();
    press({ key: 'z', metaKey: true });
    await aIsBack();
    const before = seen.length;

    const repeat = press({ key: 'z', metaKey: true, repeat: true });

    expect(undoRedoIn(seen.slice(before))).toEqual([]);
    expect(repeat.defaultPrevented).toBe(true);
  });
});

test("with the tabGroups grant, ⌘Z gives a lone tab's removed group back its look (settled A)", async () => {
  const { chrome: fake } = await renderWithProviders(<MainContainer />, {
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
  storeOpenNowDrop({ kind: 'tab', moved });
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

describe('a saved-session change and a drag: the later one wins', () => {
  test('a change after the drag: ⌘Z undoes the change, and the drag stays', async () => {
    const { store, seen } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await dragAToTheMiddle();
    await saveASession(store);
    const before = seen.length;

    press({ key: 'z', metaKey: true });
    await settle();

    expect(undoRedoIn(seen.slice(before))).toEqual([UNDO]);
    expect(await urlsIn(2)).toEqual([url('b'), url('a'), url('c')]);
  });

  test('the drag is gone for good once a change came after it: a second ⌘Z does not undo it', async () => {
    const { store } = await renderWithProviders(<MainContainer />, { seed });
    await dragAToTheMiddle();
    await saveASession(store);
    press({ key: 'z', metaKey: true });

    press({ key: 'z', metaKey: true });
    await settle();

    expect(await urlsIn(2)).toEqual([url('b'), url('a'), url('c')]);
  });

  test('a redo step is no new change: a drag made after an undo is still undone after the redo (ledger R23)', async () => {
    const { store, seen } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await saveASession(store);
    press({ key: 'z', metaKey: true });
    await dragAToTheMiddle();
    press({ key: 'Z', metaKey: true, shiftKey: true });
    // PREMISE: the redo was a real step, the save back in history.
    expect(store.getState().undoRedo.past.length).toBeGreaterThan(0);
    expect(store.getState().undoRedo.future).toEqual([]);
    const before = seen.length;

    press({ key: 'z', metaKey: true });

    await aIsBack();
    expect(undoRedoIn(seen.slice(before))).toEqual([]);
  });

  test('a drag has no redo: ⌘⇧Z after its undo redoes Redux only (ledger R5)', async () => {
    const { store, seen } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await saveASession(store);
    await dragAToTheMiddle();
    press({ key: 'z', metaKey: true });
    await aIsBack();
    const before = seen.length;

    press({ key: 'Z', metaKey: true, shiftKey: true });
    await settle();

    expect(undoRedoIn(seen.slice(before))).toEqual([REDO]);
    expect(await urlsIn(2)).toEqual([url('a'), url('b'), url('c')]);
  });
});

describe('a Reopen offer and a drag: the later one wins', () => {
  test('an offer after the drag: ⌘Z takes the offer, and the drag stays', async () => {
    const { store, seen } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await dragAToTheMiddle();
    await closeCWithOffer(store);
    const before = seen.length;

    press({ key: 'z', metaKey: true });

    await waitFor(async () => {
      expect(await urlsIn(2)).toEqual([url('b'), url('a'), url('c')]);
    });
    expect(offerShows()).toBe(false);
    expect(undoRedoIn(seen.slice(before))).toEqual([]);
  });

  test('then a second ⌘Z does not undo the drag either', async () => {
    const { store } = await renderWithProviders(<MainContainer />, { seed });
    await dragAToTheMiddle();
    await closeCWithOffer(store);
    press({ key: 'z', metaKey: true });
    await waitFor(async () => {
      expect(await urlsIn(2)).toEqual([url('b'), url('a'), url('c')]);
    });

    press({ key: 'z', metaKey: true });
    await settle();

    expect(await urlsIn(2)).toEqual([url('b'), url('a'), url('c')]);
  });

  test('a drag after the offer: ⌘Z undoes the drag and leaves the offer; a second ⌘Z takes it', async () => {
    const { store, seen } = await renderWithProviders(<MainContainer />, {
      seed,
    });
    await closeCWithOffer(store);
    await dragAToTheMiddle();
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

// Review Focus 3.
describe('a drag whose tabs moved or closed outside Tab Keeper', () => {
  test('moved by hand: ⌘Z does nothing, and undoes no older saved change', async () => {
    const {
      store,
      seen,
      chrome: fake,
    } = await renderWithProviders(<MainContainer />, { seed });
    await saveASession(store);
    await dragAToTheMiddle();
    fake.browser.moveTabToWindow(21, 1);
    const before = seen.length;

    const event = press({ key: 'z', metaKey: true });
    await settle();

    expect(event.defaultPrevented).toBe(true);
    expect(undoRedoIn(seen.slice(before))).toEqual([]);
    expect(await urlsIn(1)).toEqual([url('home'), url('a')]);
    expect(await urlsIn(2)).toEqual([url('b'), url('c')]);
  });

  test('closed: ⌘Z does nothing, and does not take an older Reopen offer', async () => {
    const {
      store,
      seen,
      chrome: fake,
    } = await renderWithProviders(<MainContainer />, { seed });
    await closeCWithOffer(store);
    await dragAToTheMiddle();
    fake.browser.closeTab(21);
    const before = seen.length;

    press({ key: 'z', metaKey: true });
    await settle();

    expect(undoRedoIn(seen.slice(before))).toEqual([]);
    expect(fake.createdTabs).toEqual([]);
    expect(offerShows()).toBe(true);
    expect(await urlsIn(2)).toEqual([url('b')]);
  });

  test('the stale drag is dropped: the next ⌘Z does the next most recent action', async () => {
    const {
      store,
      seen,
      chrome: fake,
    } = await renderWithProviders(<MainContainer />, { seed });
    await saveASession(store);
    await dragAToTheMiddle();
    fake.browser.moveTabToWindow(21, 1);
    press({ key: 'z', metaKey: true });
    await settle();
    const before = seen.length;

    press({ key: 'z', metaKey: true });

    expect(undoRedoIn(seen.slice(before))).toEqual([UNDO]);
  });
});
