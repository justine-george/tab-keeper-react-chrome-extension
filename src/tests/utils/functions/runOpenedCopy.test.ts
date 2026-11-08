import { afterEach, describe, expect, test, vi } from 'vitest';

import type { tabData } from '../../../redux/slices/tabContainerDataStateSlice';
import {
  openGroupCopy,
  openPairCopy,
  openTabCopy,
} from '../../../utils/functions/openCopies';
import type { OpenedCopy } from '../../../utils/functions/openedCopy';
import {
  recordOpened,
  runOpenedCopy,
} from '../../../utils/functions/runOpenedCopy';
import { forgetSettled } from '../../../utils/functions/settledPages';
import { restoreSession } from '../../../utils/functions/restoreSession';
import {
  RESTORE_SESSION_MESSAGE,
  type WindowSpec,
} from '../../../utils/functions/windows';
import { OPEN_INTO_WINDOW_MESSAGE } from '../../../utils/functions/openIntoWindow';
import { setupChromeFake } from '../../setup/chrome.fake';
import type { ChromeFakeHandle, ChromeSeed } from '../../setup/chrome.fake';

// KAN-893 spec, "Undo" and "Redo". Every step here is recorded from copies
// the fake really opened, as a drop leaves them.
const web = (name: string) => `https://${name}.test/`;
const GO_TO = 'Visit Site';
const LOOK = { groupId: 'g', title: 'Trip', color: 'green' };

let handle: ChromeFakeHandle | undefined;
afterEach(async () => {
  // Every fake numbers its tabs from 1000: a watched id left over would carry its settle into the next test.
  if (handle)
    forgetSettled((await chrome.tabs.query({})).flatMap((t) => t.id ?? []));
  handle?.restore();
  handle = undefined;
  vi.restoreAllMocks();
});

const saved = (name: string, extra: Partial<tabData> = {}): tabData => ({
  tabId: name,
  favicon: '',
  title: name,
  url: web(name),
  ...extra,
});

// Window 1 holds [p0 pinned, a, b, c in group 5 'Work']; window 2 has focus.
const seed = (extra: ChromeSeed = {}): ChromeSeed => ({
  windows: [
    {
      id: 1,
      tabs: [
        { id: 10, url: web('p0'), pinned: true },
        { id: 11, url: web('a'), active: true },
        { id: 12, url: web('b') },
        { id: 13, url: web('c'), groupId: 5 },
      ],
    },
    { id: 2, focused: true, tabs: [{ id: 20, url: web('other') }] },
  ],
  tabGroups: [{ id: 5, windowId: 1, title: 'Work', color: 'blue' }],
  ...extra,
});

const run = { hasTabGroups: true, pinTabKeeper: false };

// A window's strip by page name, `P` pinned, `gN` grouped.
const strip = async (windowId: number) =>
  (await chrome.tabs.query({ windowId }))
    .sort((a, b) => a.index - b.index)
    .map((t) => {
      const name = new URL(t.url ?? '').hostname.split('.')[0] || '~';
      const group = t.groupId === -1 ? '' : `g${t.groupId}`;
      return `${name}${t.pinned ? 'P' : ''}${group}`;
    });

async function tabDrop(index = 2): Promise<OpenedCopy> {
  const tab = saved('s');
  const id = await openTabCopy(tab, { windowId: 1, index, pinned: false });
  return {
    kind: 'opened',
    tabs: await recordOpened([id], [tab], true),
    group: null,
    madeWindow: null,
    reopen: { at: 'slot', windowId: 1, index, groupId: null },
    goToURLText: GO_TO,
  };
}

async function groupDrop(): Promise<OpenedCopy> {
  const tabs = [
    saved('x', { chromeGroupId: 'g' }),
    saved('y', { chromeGroupId: 'g' }),
  ];
  const ids = await openGroupCopy(tabs, LOOK, { windowId: 1, index: 3 }, GO_TO);
  return {
    kind: 'opened',
    tabs: await recordOpened(ids, tabs, true),
    group: LOOK,
    madeWindow: null,
    reopen: { at: 'slot', windowId: 1, index: 3, groupId: null },
    goToURLText: GO_TO,
  };
}

async function pairDrop(): Promise<OpenedCopy> {
  const halves = [
    saved('l', { splitId: 'q' }),
    saved('r', { splitId: 'q' }),
  ] as const;
  const ids = await openPairCopy(...halves, {
    windowId: 1,
    index: 2,
    pinned: false,
  });
  return {
    kind: 'opened',
    tabs: await recordOpened(ids, [...halves], true),
    group: null,
    madeWindow: null,
    reopen: { at: 'slot', windowId: 1, index: 2, groupId: null },
    goToURLText: GO_TO,
  };
}

const newWindowSpec: WindowSpec = {
  tabs: [saved('n0'), saved('n1')],
  focused: true,
  bounds: null,
};

async function newWindowDrop(pinTabKeeper: boolean): Promise<OpenedCopy> {
  const [made] = await restoreSession({
    type: RESTORE_SESSION_MESSAGE,
    specs: [newWindowSpec],
    goToURLText: GO_TO,
    closeOtherWindows: false,
    pinTabKeeper,
  });
  return {
    kind: 'opened',
    tabs: await recordOpened(made.tabIds, newWindowSpec.tabs, true),
    group: null,
    madeWindow: { windowId: made.windowId, stubTabId: made.stubTabId },
    reopen: { at: 'newWindow', spec: newWindowSpec },
    goToURLText: GO_TO,
  };
}

const idsOf = (step: OpenedCopy) => step.tabs.map((t) => t.tabId);
const exists = async (tabId: number) =>
  (await chrome.tabs.query({})).some((t) => t.id === tabId);

describe('undo', () => {
  test('closes exactly the tabs the drop opened', async () => {
    handle = setupChromeFake(seed());
    const step = await tabDrop();
    expect(await strip(1)).toEqual(['p0P', 'a', 's', 'b', 'cg5']);
    const result = await runOpenedCopy(step, 'undo', run);
    expect(result).toEqual({ outcome: 'done', drop: step });
    expect(await strip(1)).toEqual(['p0P', 'a', 'b', 'cg5']);
    expect(handle.removedTabIds).toEqual(idsOf(step));
  });

  test('a group: all its tabs close, and its group with them', async () => {
    handle = setupChromeFake(seed());
    const step = await groupDrop();
    expect((await runOpenedCopy(step, 'undo', run)).outcome).toBe('done');
    expect(await strip(1)).toEqual(['p0P', 'a', 'b', 'cg5']);
  });

  test('a made window holding only the dropped tabs and its stub closes', async () => {
    handle = setupChromeFake(seed());
    const step = await newWindowDrop(true);
    const windowId = step.madeWindow?.windowId ?? -1;
    expect((await runOpenedCopy(step, 'undo', run)).outcome).toBe('done');
    expect(handle.removedWindowIds).toEqual([windowId]);
  });

  test('a made window the user opened a tab in stays, and so does its stub; only the dropped tabs close', async () => {
    handle = setupChromeFake(seed());
    const step = await newWindowDrop(true);
    const windowId = step.madeWindow?.windowId ?? -1;
    const mine = handle.browser.openTab(windowId, { url: web('mine') });
    expect((await runOpenedCopy(step, 'undo', run)).outcome).toBe('done');
    expect(handle.removedWindowIds).toEqual([]);
    const left = (await chrome.tabs.query({ windowId })).map((t) => t.id);
    expect(left).toEqual([step.madeWindow?.stubTabId, mine.id]);
  });

  test('a tab added to the left shifts the indexes, and undo still runs', async () => {
    handle = setupChromeFake(seed());
    const step = await tabDrop();
    await chrome.tabs.create({ windowId: 1, url: web('left'), index: 1 });
    expect(await strip(1)).toEqual(['p0P', 'left', 'a', 's', 'b', 'cg5']);
    expect((await runOpenedCopy(step, 'undo', run)).outcome).toBe('done');
    expect(await strip(1)).toEqual(['p0P', 'left', 'a', 'b', 'cg5']);
  });

  describe('refuses, closing nothing, when a dropped tab', () => {
    // What the undo answered, which dropped tabs are still open, and which windows closed.
    const refusedAfter = async (
      change: (
        step: OpenedCopy,
        fake: ChromeFakeHandle
      ) => Promise<void> | void,
      make: () => Promise<OpenedCopy> = tabDrop
    ) => {
      handle = setupChromeFake(seed());
      const fake = handle;
      const step = await make();
      await change(step, fake);
      const { outcome } = await runOpenedCopy(step, 'undo', run);
      const kept = await Promise.all(idsOf(step).map(exists));
      return { outcome, kept, windowsClosed: fake.removedWindowIds };
    };
    const refused = (count: number) => ({
      outcome: 'changedSince',
      kept: Array<boolean>(count).fill(true),
      windowsClosed: [],
    });

    test('moved to another window', async () =>
      expect(
        await refusedAfter((step, fake) =>
          fake.browser.moveTabToWindow(idsOf(step)[0], 2)
        )
      ).toEqual(refused(1)));

    test('joined a group', async () =>
      expect(
        await refusedAfter(async (step) => {
          await chrome.tabs.group({ groupId: 5, tabIds: idsOf(step)[0] });
        })
      ).toEqual(refused(1)));

    test('was pinned', async () =>
      expect(
        await refusedAfter(async (step) => {
          await chrome.tabs.update(idsOf(step)[0], { pinned: true });
        })
      ).toEqual(refused(1)));

    test('navigated to another page', async () =>
      expect(
        await refusedAfter((step, fake) =>
          fake.browser.updateTab(idsOf(step)[0], { url: web('elsewhere') })
        )
      ).toEqual(refused(1)));

    // A fast page settles before the drop's record reads it; the next page is the user's, not a redirect.
    test('navigated after a first load that settled before the record', async () =>
      expect(
        await refusedAfter(
          (step, fake) => {
            const id = idsOf(step)[0];
            fake.browser.updateTab(id, {
              url: web('elsewhere'),
              status: 'loading',
            });
            fake.browser.updateTab(id, { status: 'complete' });
          },
          async () => {
            const tab = saved('s');
            const id = await openTabCopy(tab, {
              windowId: 1,
              index: 2,
              pinned: false,
            });
            if (id === undefined) throw new Error('no copy opened');
            handle?.browser.updateTab(id, { status: 'complete' });
            return {
              kind: 'opened',
              tabs: await recordOpened([id], [tab], true),
              group: null,
              madeWindow: null,
              reopen: { at: 'slot', windowId: 1, index: 2, groupId: null },
              goToURLText: GO_TO,
            };
          }
        )
      ).toEqual(refused(1)));

    test('was reordered among the dropped tabs', async () =>
      expect(
        await refusedAfter(async (step) => {
          await chrome.tabs.move(idsOf(step)[1], { index: 3 });
        }, groupDrop)
      ).toEqual(refused(2)));

    test('was closed (the rest stay)', async () => {
      handle = setupChromeFake(seed());
      const step = await groupDrop();
      await chrome.tabs.remove(idsOf(step)[0]);
      expect(await runOpenedCopy(step, 'undo', run)).toEqual({
        outcome: 'changedSince',
      });
      expect(await exists(idsOf(step)[1])).toBe(true);
    });
  });

  test('after the target window closed: refused, and no throw', async () => {
    handle = setupChromeFake(seed());
    const step = await tabDrop();
    handle.browser.closeWindow(1);
    await expect(runOpenedCopy(step, 'undo', run)).resolves.toEqual({
      outcome: 'changedSince',
    });
  });
});

describe('redo', () => {
  const undone = async (make: () => Promise<OpenedCopy>) => {
    const step = await make();
    const result = await runOpenedCopy(step, 'undo', run);
    if (result.outcome !== 'done') throw new Error('PREMISE: undo refused');
    return result.drop;
  };

  test('a slot drop reopens at its slot with new ids, and says which ids are new', async () => {
    handle = setupChromeFake(seed());
    const step = await undone(tabDrop);
    const result = await runOpenedCopy(step, 'redo', run);
    if (result.outcome !== 'done') throw new Error(result.outcome);
    expect(await strip(1)).toEqual(['p0P', 'a', 's', 'b', 'cg5']);
    const [newId] = idsOf(result.drop);
    expect(newId).not.toBe(idsOf(step)[0]);
    expect(result.renamed?.tabs).toEqual([[idsOf(step)[0], newId]]);
    expect(result.drop.tabs[0].place.index).toBe(2);
    forgetSettled(idsOf(result.drop));
  });

  test('the redone drop can be undone again', async () => {
    handle = setupChromeFake(seed());
    const step = await undone(tabDrop);
    const redone = await runOpenedCopy(step, 'redo', run);
    if (redone.outcome !== 'done') throw new Error(redone.outcome);
    expect((await runOpenedCopy(redone.drop, 'undo', run)).outcome).toBe(
      'done'
    );
    expect(await strip(1)).toEqual(['p0P', 'a', 'b', 'cg5']);
  });

  test('with the window gone: windowClosed, nothing opens', async () => {
    handle = setupChromeFake(seed());
    const step = await undone(tabDrop);
    handle.browser.closeWindow(1);
    const before = (await chrome.tabs.query({})).length;
    expect(await runOpenedCopy(step, 'redo', run)).toEqual({
      outcome: 'windowClosed',
    });
    expect((await chrome.tabs.query({})).length).toBe(before);
  });

  test('a slot past the window’s end lands at its end', async () => {
    handle = setupChromeFake(seed());
    const step = await undone(() => tabDrop(4));
    await chrome.tabs.remove([12, 13]);
    const result = await runOpenedCopy(step, 'redo', run);
    expect(result.outcome).toBe('done');
    expect(await strip(1)).toEqual(['p0P', 'a', 's']);
  });

  test('into a live group that is gone: the tab opens loose at its slot', async () => {
    handle = setupChromeFake(seed());
    const tab = saved('s');
    const id = await openTabCopy(tab, {
      windowId: 1,
      index: 4,
      pinned: false,
      groupId: 5,
    });
    const step: OpenedCopy = {
      kind: 'opened',
      tabs: await recordOpened([id], [tab], true),
      group: null,
      madeWindow: null,
      reopen: { at: 'slot', windowId: 1, index: 4, groupId: 5 },
      goToURLText: GO_TO,
    };
    expect(await strip(1)).toEqual(['p0P', 'a', 'b', 'cg5', 'sg5']);
    const back = await runOpenedCopy(step, 'undo', run);
    if (back.outcome !== 'done') throw new Error(back.outcome);
    await chrome.tabs.remove(13);
    const warn = vi.spyOn(console, 'warn');
    expect((await runOpenedCopy(back.drop, 'redo', run)).outcome).toBe('done');
    expect(warn).not.toHaveBeenCalled();
    expect(await strip(1)).toEqual(['p0P', 'a', 'b', 's']);
  });

  test('into a live group still there: back in that group', async () => {
    handle = setupChromeFake(seed());
    const tab = saved('s');
    const id = await openTabCopy(tab, {
      windowId: 1,
      index: 4,
      pinned: false,
      groupId: 5,
    });
    const step: OpenedCopy = {
      kind: 'opened',
      tabs: await recordOpened([id], [tab], true),
      group: null,
      madeWindow: null,
      reopen: { at: 'slot', windowId: 1, index: 4, groupId: 5 },
      goToURLText: GO_TO,
    };
    const back = await runOpenedCopy(step, 'undo', run);
    if (back.outcome !== 'done') throw new Error(back.outcome);
    expect((await runOpenedCopy(back.drop, 'redo', run)).outcome).toBe('done');
    expect(await strip(1)).toEqual(['p0P', 'a', 'b', 'cg5', 'sg5']);
  });

  test('a group comes back as one group with its look, the old group id renamed', async () => {
    handle = setupChromeFake(seed());
    const step = await undone(groupDrop);
    const result = await runOpenedCopy(step, 'redo', run);
    if (result.outcome !== 'done') throw new Error(result.outcome);
    const [first] = result.drop.tabs;
    expect(first.place.group?.title).toBe('Trip');
    expect(result.drop.tabs.map((t) => t.place.groupId)).toEqual([
      first.place.groupId,
      first.place.groupId,
    ]);
    expect(result.renamed?.groups).toEqual([
      [step.tabs[0].place.groupId, first.place.groupId],
    ]);
  });

  test('a pair comes back split', async () => {
    handle = setupChromeFake(seed({ splitView: true }));
    const step = await undone(pairDrop);
    const result = await runOpenedCopy(step, 'redo', run);
    if (result.outcome !== 'done') throw new Error(result.outcome);
    const [l, r] = await Promise.all(
      idsOf(result.drop).map((id) => chrome.tabs.get(id))
    );
    expect(l.splitViewId).not.toBe(-1);
    expect(l.splitViewId).toBe(r.splitViewId);
  });

  test('a New window drop opens its window again, asking the worker for the ids', async () => {
    handle = setupChromeFake(seed({ action: {} }));
    vi.resetModules();
    await import('../../../background');
    const step = await undone(() => newWindowDrop(true));
    const send = vi.spyOn(chrome.runtime, 'sendMessage');
    const result = await runOpenedCopy(step, 'redo', {
      ...run,
      pinTabKeeper: true,
    });
    if (result.outcome !== 'done') throw new Error(result.outcome);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      type: RESTORE_SESSION_MESSAGE,
      answers: true,
      pinTabKeeper: true,
    });
    const made = result.drop.madeWindow;
    expect(made?.windowId).not.toBe(step.madeWindow?.windowId);
    expect(result.renamed?.windows).toEqual([
      [step.madeWindow?.windowId, made?.windowId],
    ]);
    expect(
      (await chrome.tabs.query({ windowId: made?.windowId })).map((t) => t.id)
    ).toEqual([made?.stubTabId, ...idsOf(result.drop)]);
  });

  test('a window at the end of an open one opens there again, only what it opened', async () => {
    handle = setupChromeFake(seed({ action: {} }));
    vi.resetModules();
    await import('../../../background');
    const spec: WindowSpec = {
      tabs: [saved('w0'), saved('w1')],
      focused: false,
      bounds: null,
    };
    const answer = (await chrome.runtime.sendMessage({
      type: OPEN_INTO_WINDOW_MESSAGE,
      windowId: 1,
      specs: [spec],
      goToURLText: GO_TO,
      activate: false,
      pinTabKeeper: false,
      skipTabsAlreadyOpen: false,
    })) as { ids: number[] };
    const step = await undone(async () => ({
      kind: 'opened',
      tabs: await recordOpened(answer.ids, spec.tabs, true),
      group: null,
      madeWindow: null,
      reopen: { at: 'windowEnd', windowId: 1, spec },
      goToURLText: GO_TO,
    }));
    expect(await strip(1)).toEqual(['p0P', 'a', 'b', 'cg5']);
    const result = await runOpenedCopy(step, 'redo', run);
    if (result.outcome !== 'done') throw new Error(result.outcome);
    expect(await strip(1)).toEqual(['p0P', 'a', 'b', 'cg5', 'w0', '~']);
    expect(result.drop.tabs.map((t) => t.saved.tabId)).toEqual(['w0', 'w1']);
  });

  test('a window-end redo whose window closed as the worker opened it: the new window it made instead is the step', async () => {
    handle = setupChromeFake(seed());
    const spec: WindowSpec = {
      tabs: [saved('w0')],
      focused: false,
      bounds: null,
    };
    const id = await openTabCopy(spec.tabs[0], {
      windowId: 1,
      index: 4,
      pinned: false,
    });
    const step = await undone(async () => ({
      kind: 'opened',
      tabs: await recordOpened([id], spec.tabs, true),
      group: null,
      madeWindow: null,
      reopen: { at: 'windowEnd', windowId: 1, spec },
      goToURLText: GO_TO,
    }));
    // The worker's fallback: a new window, answered as made, nothing in window 1.
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(async () => {
      const made = await restoreSession({
        type: RESTORE_SESSION_MESSAGE,
        specs: [spec],
        goToURLText: GO_TO,
        closeOtherWindows: false,
        pinTabKeeper: false,
      });
      return {
        ids: [],
        savedTabIds: [],
        leftOut: 0,
        alreadyOpen: [],
        madeWindows: made,
      };
    });
    const result = await runOpenedCopy(step, 'redo', run);
    if (result.outcome !== 'done') throw new Error(result.outcome);
    const windowId = result.drop.madeWindow?.windowId ?? -1;
    expect(result.drop.reopen.at).toBe('newWindow');
    expect((await chrome.tabs.query({ windowId })).map((t) => t.id)).toEqual(
      idsOf(result.drop)
    );
    expect((await runOpenedCopy(result.drop, 'undo', run)).outcome).toBe(
      'done'
    );
    expect(handle.removedWindowIds).toEqual([windowId]);
  });

  test('a New window redo with no answer could not run', async () => {
    handle = setupChromeFake(seed());
    const step = await undone(() => newWindowDrop(false));
    vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue(undefined);
    expect(await runOpenedCopy(step, 'redo', run)).toEqual({
      outcome: 'couldNotRun',
    });
  });
});
