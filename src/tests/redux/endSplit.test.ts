import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
  });
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
}));

import { endOpenSplit } from '../../redux/endSplit';
import {
  setHasTabGroupsPermission,
  setIsNotDirty,
} from '../../redux/slices/globalStateSlice';
import {
  endSavedSplitInternal,
  saveToTabContainerInternal,
  type tabData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { redo, undo } from '../../redux/slices/undoRedoSlice';
import { onTabMovesEnded, redoStep, undoStep } from '../../redux/undoHistory';
import type { OpenTab } from '../../utils/functions/openNow';
import { setupChromeFake } from '../setup/chrome.fake';
import type { ChromeFakeHandle } from '../setup/chrome.fake';
import { makeTestStore } from '../setup/makeStore';

const t = (tabId: string, extra: Partial<tabData> = {}): tabData => ({
  tabId,
  favicon: '',
  title: tabId,
  url: `https://${tabId}.test`,
  ...extra,
});

describe('endSavedSplitInternal (KAN-942)', () => {
  const half = (tabId: string) => t(tabId, { splitId: 's' });
  const seeded = (tabs: tabData[]) => {
    const { store } = makeTestStore();
    store.dispatch(
      saveToTabContainerInternal({
        tabGroupId: 'tg',
        title: 'Session',
        createdTime: '2026-11-06 00:00:00',
        windowCount: 1,
        tabCount: tabs.length,
        isAutoSave: false,
        isSelected: false,
        windows: [
          {
            windowId: 'w',
            windowHeight: 100,
            windowWidth: 100,
            windowOffsetTop: 0,
            windowOffsetLeft: 0,
            tabCount: tabs.length,
            title: 'w',
            tabs,
          },
        ],
      })
    );
    store.dispatch(setIsNotDirty());
    return store;
  };
  const end = (tabId: string) =>
    endSavedSplitInternal({ tabGroupId: 'tg', windowId: 'w', tabId });
  const splitIds = (s: ReturnType<typeof seeded>) =>
    s
      .getState()
      .tabContainerDataState.tabGroups[0].windows[0].tabs.map((x) => x.splitId);

  it.each(['h1', 'h2'])('ending from %s clears both halves', (tabId) => {
    const s = seeded([t('a'), half('h1'), half('h2')]);
    s.dispatch(end(tabId));
    expect(splitIds(s)).toEqual([undefined, undefined, undefined]);
  });

  it('is one undo step, and redo ends it again', () => {
    const s = seeded([half('h1'), half('h2')]);
    s.dispatch(end('h1'));
    s.dispatch(undo());
    expect(splitIds(s)).toEqual(['s', 's']);
    s.dispatch(redo());
    expect(splitIds(s)).toEqual([undefined, undefined]);
  });

  it('dirties the container for a cloud write', () => {
    const s = seeded([half('h1'), half('h2')]);
    s.dispatch(end('h1'));
    expect(s.getState().globalState.isDirty).toBe(true);
  });

  it('a plain tab is no edit', () => {
    const s = seeded([t('a'), half('h1'), half('h2')]);
    const before = s.getState().tabContainerDataState;
    s.dispatch(end('a'));
    expect(s.getState().tabContainerDataState).toBe(before);
  });

  it('a broken pair is no edit', () => {
    const s = seeded([half('h1'), t('m'), half('h2')]);
    const before = s.getState().tabContainerDataState;
    s.dispatch(end('h1'));
    expect(s.getState().tabContainerDataState).toBe(before);
  });
});

describe('endOpenSplit (KAN-942)', () => {
  let handle: ChromeFakeHandle | undefined;
  beforeEach(() => {
    handle = setupChromeFake({
      splitView: true,
      windows: [
        {
          id: 1,
          tabs: [
            { id: 11, active: true },
            { id: 12, splitViewId: 70 },
            { id: 13, splitViewId: 70 },
            { id: 14 },
          ],
        },
      ],
    });
  });
  afterEach(() => {
    handle?.restore();
    handle = undefined;
  });

  const open = (id: number, splitViewId?: number): OpenTab => ({
    id,
    windowId: 1,
    title: `${id}`,
    url: `https://${id}.test/`,
    favIconUrl: '',
    active: false,
    pinned: false,
    audible: false,
    muted: false,
    groupId: null,
    index: id - 11,
    ...(splitViewId === undefined ? {} : { splitViewId }),
  });
  const FIRST = open(12, 70);
  const SECOND = open(13, 70);
  const ready = () => {
    const { store } = makeTestStore();
    store.dispatch(setHasTabGroupsPermission(true));
    return store;
  };
  const splitOf = async (id: number) => (await chrome.tabs.get(id)).splitViewId;
  const hasStep = (s: ReturnType<typeof ready>) =>
    s.getState().undoRedo.present.liveStep !== undefined;

  it('ends the split, and keeps one live step though nothing moved', async () => {
    const s = ready();
    expect(await s.dispatch(endOpenSplit(FIRST, SECOND))).toBe(true);
    expect(await splitOf(12)).toBe(-1);
    expect(await splitOf(13)).toBe(-1);
    expect(hasStep(s)).toBe(true);
  });

  it('a split already ended: false, no step, and Open now reads again', async () => {
    const s = ready();
    const heard = vi.fn();
    const stop = onTabMovesEnded(heard);
    expect(await s.dispatch(endOpenSplit(open(12, 999), open(13, 999)))).toBe(
      false
    );
    stop();
    expect(hasStep(s)).toBe(false);
    expect(heard).toHaveBeenCalled();
  });

  it('no unsplit: false, no step', async () => {
    const s = ready();
    Reflect.deleteProperty(chrome.tabs, 'unsplit');
    expect(await s.dispatch(endOpenSplit(FIRST, SECOND))).toBe(false);
    expect(hasStep(s)).toBe(false);
  });

  it('a tab in no split: false, and Chrome is not asked', async () => {
    const s = ready();
    const ask = vi.fn(() => Promise.resolve());
    Reflect.set(chrome.tabs, 'unsplit', ask);
    expect(await s.dispatch(endOpenSplit(open(11), SECOND))).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });

  describe('its undo step', () => {
    const ended = async () => {
      const s = ready();
      await s.dispatch(endOpenSplit(FIRST, SECOND));
      return s;
    };
    const sameSplit = async () => {
      const [a, b] = [await splitOf(12), await splitOf(13)];
      return a !== undefined && a > 0 && a === b;
    };

    it('undo runs createSplit on the two tabs', async () => {
      const s = await ended();
      await s.dispatch(undoStep());
      expect(await sameSplit()).toBe(true);
    });

    it('redo ends the split undo made, by its new id', async () => {
      const s = await ended();
      await s.dispatch(undoStep());
      await s.dispatch(redoStep());
      expect(await splitOf(12)).toBe(-1);
      expect(await splitOf(13)).toBe(-1);
    });

    it('undo refused when a half moved', async () => {
      const s = await ended();
      await chrome.tabs.move(13, { index: 0 });
      const { payload } = await s.dispatch(undoStep());
      expect(payload).toBe('refused');
      expect(await sameSplit()).toBe(false);
    });

    it('undo refused when a half closed', async () => {
      const s = await ended();
      await chrome.tabs.remove(13);
      const { payload } = await s.dispatch(undoStep());
      expect(payload).toBe('refused');
    });

    it('undo refused when a half is already in a split', async () => {
      const s = await ended();
      const createSplit: unknown = Reflect.get(chrome.tabs, 'createSplit');
      if (typeof createSplit !== 'function') throw new Error('no createSplit');
      await Reflect.apply(createSplit, chrome.tabs, [[13, 14]]);
      const { payload } = await s.dispatch(undoStep());
      expect(payload).toBe('refused');
    });
  });
});
