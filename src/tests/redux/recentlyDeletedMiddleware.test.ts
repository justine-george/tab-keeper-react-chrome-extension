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

import { makeTestStore } from '../setup/makeStore';
import { setupChromeFake } from '../setup/chrome.fake';
import {
  deleteChromeTabGroupInternal,
  deleteTab,
  deleteTabContainer,
  deleteTabContainerInternal,
  deleteWindow,
  replaceState,
  restoreDeletedSession,
  type SessionMove,
  type TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';
import { redo, resetHistory, undo } from '../../redux/slices/undoRedoSlice';
import { moveToSession } from '../../redux/moveToSession';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { SAMPLE_ID_PREFIX } from '../../utils/functions/sampleSession';
import {
  RECENTLY_DELETED_KEY,
  deletedSessionsFrom,
  emptyDeleted,
} from '../../utils/functions/recentlyDeleted';
import {
  T0,
  container,
  group,
  s1,
  s2,
  s3,
  session,
  tab,
  win,
} from '../fixtures/sessionMoveFixture';

// KAN-595. A delete that takes a whole session with it records that session
// in Recently deleted; a move that empties one does not.

let handle: ReturnType<typeof setupChromeFake> | undefined;

const ready = (c: TabMasterContainer = container()) => {
  handle = setupChromeFake();
  const made = makeTestStore();
  made.store.dispatch(replaceState(c));
  made.store.dispatch(
    resetHistory({
      tabContainerDataState: made.store.getState().tabContainerDataState,
    })
  );
  made.store.dispatch(setIsNotDirty());
  return made;
};

// The write is fire-and-forget; let its two awaits (read, then set) settle.
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const recorded = async () => {
  await settled();
  return deletedSessionsFrom(handle?.localArea()[RECENTLY_DELETED_KEY]);
};
const recordedIds = async () =>
  (await recorded()).map((e) => e.session.tabGroupId);

const live = (store: ReturnType<typeof makeTestStore>['store']) =>
  store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  localStorage.clear();
});

afterEach(() => {
  handle?.restore();
  handle = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('what records a delete', () => {
  it('deleting a session records it, unselected, at the time of the delete', async () => {
    const { store } = ready(container([s3(), s2(), s1()], 'S2'));
    await store.dispatch(deleteTabContainer('S2'));
    const [entry, ...rest] = await recorded();
    expect(rest).toEqual([]);
    expect(entry.session.tabGroupId).toBe('S2');
    expect(entry.session.title).toBe('Target');
    expect(entry.session.isSelected).toBe(false);
    expect(entry.deletedAt).toBe(T0);
  });

  it("deleting a session's only tab records the session", async () => {
    const { store } = ready();
    await store.dispatch(
      deleteTab({ tabGroupId: 'S3', windowId: 'x1', tabId: 'v1' })
    );
    expect(live(store)).not.toContain('S3');
    expect(await recordedIds()).toEqual(['S3']);
  });

  it("deleting a session's only window records the session", async () => {
    const { store } = ready();
    await store.dispatch(deleteWindow({ tabGroupId: 'S3', windowId: 'x1' }));
    expect(await recordedIds()).toEqual(['S3']);
  });

  it("deleting a session's only group records the session", async () => {
    const grouped = session('S4', 'Grouped', T0 - 60_000, [
      win('y1', [tab('g', 'k1')], [group('k1')]),
    ]);
    const { store } = ready(container([grouped, s3()]));
    store.dispatch(
      deleteChromeTabGroupInternal({
        tabGroupId: 'S4',
        windowId: 'y1',
        groupId: 'k1',
      })
    );
    expect(live(store)).not.toContain('S4');
    expect(await recordedIds()).toEqual(['S4']);
  });

  it('deleting one of several tabs records nothing', async () => {
    const { store } = ready();
    await store.dispatch(
      deleteTab({ tabGroupId: 'S2', windowId: 'd1', tabId: 'u1' })
    );
    expect(await recordedIds()).toEqual([]);
  });

  it('a move that empties its source records nothing: the tab lives on', async () => {
    const lonely = session('S1', 'Source', T0 - 3 * 3_600_000, [
      win('w2', [tab('t3')]),
    ]);
    const { store } = ready(container([s3(), s2(), lonely]));
    const move: SessionMove = {
      carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w2', tabId: 't3' },
      to: { tabGroupId: 'S2', windowId: 'd2', toIndex: 0 },
    };
    store.dispatch(moveToSession({ move, announceMoved: true }));
    expect(live(store)).not.toContain('S1');
    expect(await recordedIds()).toEqual([]);
  });

  it("the tour's sample session is not recorded", async () => {
    const sampleId = `${SAMPLE_ID_PREFIX}paris`;
    const sample = session(sampleId, 'Paris', T0 - 60_000, [
      win('p1', [tab('p')]),
    ]);
    const { store } = ready(container([sample, s3()]));
    store.dispatch(deleteTabContainerInternal(sampleId));
    expect(live(store)).not.toContain(sampleId);
    expect(await recordedIds()).toEqual([]);
  });

  it('undo then redo of a delete leaves exactly the one entry', async () => {
    const { store } = ready();
    await store.dispatch(deleteTabContainer('S2'));
    store.dispatch(undo());
    expect(live(store)).toContain('S2');
    store.dispatch(redo());
    expect(live(store)).not.toContain('S2');
    const entries = await recorded();
    expect(entries.map((e) => e.session.tabGroupId)).toEqual(['S2']);
    expect(entries[0].deletedAt).toBe(T0);
  });
});

describe('a record that fails', () => {
  it('still deletes and still says so', async () => {
    const { store } = ready();
    vi.spyOn(chrome.storage.local, 'set').mockRejectedValue(
      new Error('QUOTA_BYTES quota exceeded')
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await store.dispatch(deleteTabContainer('S2'));
    await settled();
    expect(live(store)).not.toContain('S2');
    expect(store.getState().globalState.toasts.map((t) => t.text)).toContain(
      TOAST_MESSAGES.DELETE_TAB_CONTAINER_SUCCESS
    );
    expect(error).toHaveBeenCalledTimes(1);
  });
});

// Review (Important 1): each record reads the list and writes it back, so two
// in flight at once kept only the last write.
describe('records in flight at once', () => {
  it('two deletes back to back are both recorded', async () => {
    const { store } = ready();
    void store.dispatch(deleteTabContainer('S2'));
    void store.dispatch(deleteTabContainer('S3'));
    expect((await recordedIds()).sort()).toEqual(['S2', 'S3']);
  });

  it('Empty pressed while a record is in flight stays empty', async () => {
    const { store } = ready();
    void store.dispatch(deleteTabContainer('S2'));
    void emptyDeleted();
    expect(await recordedIds()).toEqual([]);
  });
});

// Review (Important 2): an entry is used up when its session comes back, and
// put back only when this page's undo or redo takes that session away again.
describe('an entry is used up when its session comes back', () => {
  const lonely = () =>
    session('S1', 'Source', T0 - 3 * 3_600_000, [win('w2', [tab('t3')])]);
  const EMPTIES_S1: SessionMove = {
    carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w2', tabId: 't3' },
    to: { tabGroupId: 'S2', windowId: 'd2', toIndex: 0 },
  };

  it('delete, undo, then a move that empties it: nothing is listed', async () => {
    const { store } = ready(container([s3(), s2(), lonely()]));
    await store.dispatch(deleteTabContainer('S1'));
    await settled();
    store.dispatch(undo());
    await settled();
    store.dispatch(moveToSession({ move: EMPTIES_S1, announceMoved: true }));
    expect(live(store)).not.toContain('S1');
    expect(await recordedIds()).toEqual([]);
  });

  it('undo of a delete uses the entry up; redo puts it back as it was', async () => {
    const { store } = ready();
    await store.dispatch(deleteTabContainer('S2'));
    await settled();
    store.dispatch(undo());
    expect(await recordedIds()).toEqual([]);
    vi.setSystemTime(T0 + 60_000);
    store.dispatch(redo());
    const entries = await recorded();
    expect(entries.map((e) => e.session.tabGroupId)).toEqual(['S2']);
    expect(entries[0].deletedAt).toBe(T0);
  });

  it('a restore uses the entry up; its undo puts it back as it was', async () => {
    const { store } = ready();
    await store.dispatch(deleteTabContainer('S2'));
    const [entry] = await recorded();
    vi.setSystemTime(T0 + 60_000);
    await store.dispatch(restoreDeletedSession(entry.session));
    expect(await recordedIds()).toEqual([]);
    store.dispatch(undo());
    expect(live(store)).not.toContain('S2');
    const back = await recorded();
    expect(back.map((e) => e.session.tabGroupId)).toEqual(['S2']);
    expect(back[0].deletedAt).toBe(T0);
    store.dispatch(redo());
    expect(live(store)).toContain('S2');
    expect(await recordedIds()).toEqual([]);
  });

  it('a fresh delete forgets an older spent entry, so Empty stays permanent', async () => {
    const { store } = ready();
    await store.dispatch(deleteTabContainer('S2'));
    const [first] = await recorded();
    await store.dispatch(restoreDeletedSession(first.session));
    await settled();
    vi.setSystemTime(T0 + 60_000);
    await store.dispatch(deleteTabContainer('S2'));
    await settled();
    await emptyDeleted();
    store.dispatch(undo());
    store.dispatch(redo());
    expect(live(store)).not.toContain('S2');
    expect(await recordedIds()).toEqual([]);
  });
});
