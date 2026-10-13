import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { offerTabGroupsOnReturn } from '../../redux/tabGroupsOfferOnReturn';
import {
  closeTabGroupsPrompt,
  runShownHere,
} from '../../redux/slices/globalStateSlice';
import { makeTestStore } from '../setup/makeStore';
import { setupChromeFake, type ChromeFakeHandle } from '../setup/chrome.fake';

// KAN-565 (pick B). A return to the full view decides the tab group offer
// again, until the page has shown it once. A return is visibilitychange to
// visible, which jsdom never fires on its own.

let handle: ChromeFakeHandle | undefined;
let visibility: DocumentVisibilityState = 'visible';
let stop: () => void = () => undefined;

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
    () => visibility
  );
});
afterEach(() => {
  stop();
  handle?.restore();
  handle = undefined;
  visibility = 'visible';
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const withGroups = (count: number) => {
  handle?.restore();
  handle = setupChromeFake({
    tabs: [
      ...Array.from({ length: count }, (_, i) => ({ groupId: 11 + i })),
      { groupId: -1 },
    ],
  });
};

// Leaves the tab, then comes back to it.
async function comeBack() {
  visibility = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  visibility = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  // shouldOfferTabGroups awaits two chrome reads.
  await vi.waitFor(() => Promise.resolve());
  await new Promise((r) => setTimeout(r, 0));
}

const offered = (store: ReturnType<typeof makeTestStore>['store']) =>
  store.getState().globalState.tabGroupsPromptCount;

describe('the tab group offer on a return to the full view (KAN-565)', () => {
  test('no groups at the load, a group made since: the return offers it', async () => {
    const { store } = makeTestStore();
    withGroups(0);
    stop = offerTabGroupsOnReturn(store.dispatch, store.getState, false);
    // CONTROL: a return with nothing to offer offers nothing.
    await comeBack();
    expect(offered(store)).toBeNull();

    withGroups(1);
    await comeBack();
    expect(offered(store)).toBe(1);
  });

  test('once offered, later returns stay quiet until the page loads again', async () => {
    const { store } = makeTestStore();
    withGroups(2);
    stop = offerTabGroupsOnReturn(store.dispatch, store.getState, false);
    await comeBack();
    expect(offered(store)).toBe(2);
    store.dispatch(closeTabGroupsPrompt());

    await comeBack();
    expect(offered(store)).toBeNull();
  });

  test("the load's own offer counts: a page that offered at the load stays quiet", async () => {
    const { store } = makeTestStore();
    withGroups(2);
    stop = offerTabGroupsOnReturn(store.dispatch, store.getState, true);
    await comeBack();
    expect(offered(store)).toBeNull();
  });

  test('never over an open dialog; a return after it closes offers', async () => {
    const { store } = makeTestStore();
    withGroups(1);
    stop = offerTabGroupsOnReturn(store.dispatch, store.getState, false);
    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    dialog.showModal();
    await comeBack();
    expect(offered(store)).toBeNull();
    dialog.close();

    await comeBack();
    expect(offered(store)).toBe(1);
  });

  test('once a tour ran in this page, a return offers nothing (KAN-413)', async () => {
    const { store } = makeTestStore();
    withGroups(1);
    store.dispatch(runShownHere());
    stop = offerTabGroupsOnReturn(store.dispatch, store.getState, false);
    await comeBack();
    expect(offered(store)).toBeNull();
  });

  test('leaving the tab decides nothing; only coming back does', async () => {
    const { store } = makeTestStore();
    withGroups(1);
    stop = offerTabGroupsOnReturn(store.dispatch, store.getState, false);
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 0));
    expect(offered(store)).toBeNull();
  });
});
