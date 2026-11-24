import { afterEach, describe, expect, test, vi } from 'vitest';

// common.ts reads window.screen at module load, and showSession reads window.location.search.
vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
    location: { search: '' },
  });
});

const mocks = vi.hoisted(() => ({ prepare: vi.fn() }));

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
  ensureCloudSessionReady: vi.fn(async () => undefined),
}));

// What the glide was asked to measure; the drawing itself is a browser's (e2e/add-arrives-glide.spec.ts).
vi.mock('../../components/common/layoutGlide', () => ({
  panes: (name: string) => [`pane:${name}`],
  prepareLayoutGlide: mocks.prepare,
}));

import { redoStep, undoStep } from '../../redux/undoHistory';
import { noteStep, prepareStepGlide } from '../../redux/stepGlides';
import { carryToNewSession } from '../../redux/commitCarry';
import { dropOnTop } from '../../redux/dropOnTop';
import { sessionDrop } from '../../redux/dropSpecs';
import { liveItem } from '../../redux/carriedItem';
import { live } from '../fixtures/liveSnapshotFixture';
import {
  addCurrTabToChromeGroup,
  addCurrTabToWindow,
  addCurrWindowToTabGroup,
  deleteChromeTabGroup,
  deleteTab,
  deleteTabContainer,
  deleteWindow,
  endSavedSplit,
  removeDuplicateTabs,
  replaceState,
  resetSessionOrder,
  sortGroupTabsBySite,
  sortSessions,
  sortTabsBySite,
  sortWindowGroupsByName,
  ungroupSavedGroup,
  updateTabGroupTitle,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setPresentStartup } from '../../redux/slices/undoRedoSlice';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-993 (his pick B). An add's undo closes up as a delete does and its redo
// arrives again; a step no add noted asks for no glide.

afterEach(() => mocks.prepare.mockClear());

// Session s1: one window, its one tab in group g1.
function setup() {
  const { store } = makeTestStore();
  const base = buildSession({ tabGroupId: 's1' });
  const window = {
    ...base.windows[0],
    tabs: base.windows[0].tabs.map((t) => ({ ...t, chromeGroupId: 'g1' })),
    chromeTabGroups: [
      { groupId: 'g1', title: 'Group', color: 'blue' as const },
    ],
  };
  const container = buildContainer([{ ...base, windows: [window] }]);
  store.dispatch(replaceState(container));
  store.dispatch(setPresentStartup({ tabContainerDataState: container }));
  return store;
}

const tab = {
  tabId: 'added',
  favicon: '',
  title: 'Added',
  url: 'https://added.test/',
};

describe('undo and redo play the step backwards and again', () => {
  test('Add current tab: undo closes up the detail pane, redo arrives there', async () => {
    const store = setup();
    store.dispatch(
      addCurrTabToWindow({
        tabGroupId: 's1',
        windowId: 'window-1',
        tabData: tab,
      })
    );

    await store.dispatch(undoStep());
    expect(mocks.prepare).toHaveBeenLastCalledWith(
      ['pane:detail'],
      'depart',
      'undo or redo'
    );
    await store.dispatch(redoStep());
    expect(mocks.prepare).toHaveBeenLastCalledWith(
      ['pane:detail'],
      'arrive',
      'undo or redo'
    );
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
  });

  test('Add current window: the same, in the detail pane', async () => {
    const store = setup();
    await store.dispatch(
      addCurrWindowToTabGroup({
        tabGroupId: 's1',
        window: {
          ...buildSession().windows[0],
          windowId: 'window-2',
          tabs: [tab],
        },
      })
    );

    await store.dispatch(undoStep());
    expect(mocks.prepare).toHaveBeenLastCalledWith(
      ['pane:detail'],
      'depart',
      'undo or redo'
    );
  });

  test('Add current tab to group: the same, in the detail pane', async () => {
    const store = setup();
    store.dispatch(
      addCurrTabToChromeGroup({
        tabGroupId: 's1',
        windowId: 'window-1',
        groupId: 'g1',
        tabData: tab,
      })
    );

    await store.dispatch(undoStep());
    expect(mocks.prepare).toHaveBeenLastCalledWith(
      ['pane:detail'],
      'depart',
      'undo or redo'
    );
  });

  test('a session made by a drop on New session: undo closes up the sessions list', async () => {
    const store = setup();
    const carried = liveItem({
      pick: { kind: 'tab', windowId: 'live-w', tabId: 'l1' },
      window: live(),
      chromeWindowId: 7,
    });
    expect(store.dispatch(carryToNewSession(carried, 'New Tab Group'))).toBe(
      true
    );

    await store.dispatch(undoStep());
    expect(mocks.prepare).toHaveBeenLastCalledWith(
      ['pane:sessions'],
      'depart',
      'undo or redo'
    );
  });

  test('a deleted tab: undo opens its gap and it fades back in, redo takes it again', async () => {
    const store = setup();
    await store.dispatch(
      deleteTab({ tabGroupId: 's1', windowId: 'window-1', tabId: 'tab-1' })
    );

    await store.dispatch(undoStep());
    expect(mocks.prepare).toHaveBeenLastCalledWith(
      ['pane:detail'],
      'delete',
      'undo or redo'
    );
    await store.dispatch(redoStep());
    expect(mocks.prepare).toHaveBeenLastCalledWith(
      ['pane:detail'],
      'delete',
      'undo or redo'
    );
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
  });

  test('a deleted window and a deleted group: the same, in the detail pane', async () => {
    const store = setup();
    await store.dispatch(
      deleteChromeTabGroup({
        tabGroupId: 's1',
        windowId: 'window-1',
        groupId: 'g1',
      })
    );
    await store.dispatch(undoStep());
    expect(mocks.prepare).toHaveBeenLastCalledWith(
      ['pane:detail'],
      'delete',
      'undo or redo'
    );

    mocks.prepare.mockClear();
    await store.dispatch(
      deleteWindow({ tabGroupId: 's1', windowId: 'window-1' })
    );
    await store.dispatch(undoStep());
    expect(mocks.prepare).toHaveBeenLastCalledWith(
      ['pane:detail'],
      'delete',
      'undo or redo'
    );
  });

  test('a deleted session: the same, in the sessions list', async () => {
    const store = setup();
    await store.dispatch(deleteTabContainer('s1'));

    await store.dispatch(undoStep());
    expect(mocks.prepare).toHaveBeenLastCalledWith(
      ['pane:sessions'],
      'delete',
      'undo or redo'
    );
  });

  test('a drop: undo leaves its landing the way it came, redo lands again, in either pane', async () => {
    const { store } = makeTestStore();
    const two = buildContainer([
      buildSession({ tabGroupId: 'a', title: 'a' }),
      buildSession({ tabGroupId: 'b', title: 'b' }),
    ]);
    store.dispatch(replaceState(two));
    store.dispatch(setPresentStartup({ tabContainerDataState: two }));
    store.dispatch(dropOnTop(sessionDrop('b', 0)));
    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    ).toEqual(['b', 'a']);
    mocks.prepare.mockClear();

    await store.dispatch(undoStep());
    expect(mocks.prepare).toHaveBeenLastCalledWith(
      ['pane:detail', 'pane:sessions'],
      'depart',
      'undo or redo'
    );
    await store.dispatch(redoStep());
    expect(mocks.prepare).toHaveBeenLastCalledWith(
      ['pane:detail', 'pane:sessions'],
      'arrive',
      'undo or redo'
    );
  });

  test('a step no add noted asks for nothing', async () => {
    const store = setup();
    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 's1', editableTitle: 'Renamed' })
    );

    await store.dispatch(undoStep());
    await store.dispatch(redoStep());
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});

describe('noteStep', () => {
  test('a null step (no step was recorded) is not noted', () => {
    noteStep(null, 'sessions', 'add');
    prepareStepGlide(undefined, 'undo');
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  test('keeps the newest 200 notes: the oldest is let go first', () => {
    const base = 1_000_000;
    for (let i = 0; i <= 200; i++) noteStep(base + i, 'sessions', 'delete');

    prepareStepGlide(base, 'undo');
    expect(mocks.prepare).not.toHaveBeenCalled();
    prepareStepGlide(base + 1, 'undo');
    expect(mocks.prepare).toHaveBeenLastCalledWith(
      ['pane:sessions'],
      'delete',
      'undo or redo'
    );
  });
});

// KAN-996 (his picks, rounds 3 and 4). The sorts, Ungroup and End split glide
// at the press, back on undo and again on redo; Remove duplicates fades as a
// delete does and lights up the copies it kept, and its undo lights the
// copies that come back.
describe('the sorts and leaves glide at the press, and back and again', () => {
  const at = (id: string, url: string, more: object = {}) => ({
    tabId: id,
    favicon: '',
    title: id,
    url,
    ...more,
  });
  // One window: sites a, b, a (one a is a copy), two groups out of name order, a split pair.
  function store() {
    const { store } = makeTestStore();
    const base = buildSession({ tabGroupId: 's1' });
    const window = {
      ...base.windows[0],
      tabs: [
        at('a1', 'https://a.test/'),
        at('b1', 'https://b.test/'),
        at('a2', 'https://a.test/'),
        at('z1', 'https://z.test/1', { chromeGroupId: 'gz' }),
        at('z2', 'https://z.test/2', { chromeGroupId: 'gz' }),
        at('r1', 'https://r.test/1', { chromeGroupId: 'gr' }),
        at('r2', 'https://y.test/1', { chromeGroupId: 'gr' }),
        at('r3', 'https://r.test/2', { chromeGroupId: 'gr' }),
        at('h1', 'https://h.test/1', { splitId: 'sp' }),
        at('h2', 'https://h.test/2', { splitId: 'sp' }),
      ],
      chromeTabGroups: [
        { groupId: 'gz', title: 'Zen', color: 'red' as const },
        { groupId: 'gr', title: 'Art', color: 'blue' as const },
      ],
    };
    const second = buildSession({ tabGroupId: 's2', title: 'Another' });
    const container = buildContainer([{ ...base, windows: [window] }, second]);
    store.dispatch(replaceState(container));
    store.dispatch(setPresentStartup({ tabContainerDataState: container }));
    return store;
  }
  const W = { tabGroupId: 's1', windowId: 'window-1' };

  async function backAndAgain(
    s: ReturnType<typeof store>,
    pane: string,
    kind: string
  ) {
    await s.dispatch(undoStep());
    expect(mocks.prepare).toHaveBeenLastCalledWith(
      [pane],
      kind,
      'undo or redo'
    );
    await s.dispatch(redoStep());
    expect(mocks.prepare).toHaveBeenLastCalledWith(
      [pane],
      kind,
      'undo or redo'
    );
  }

  test('Sort tabs by site, a window or a group: the detail pane reorders', async () => {
    // The group first: sorting the window sorts inside each group too.
    const s = store();
    await s.dispatch(sortGroupTabsBySite({ ...W, groupId: 'gr' }));
    expect(mocks.prepare).toHaveBeenLastCalledWith(['pane:detail'], 'reorder');
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    await backAndAgain(s, 'pane:detail', 'reorder');

    mocks.prepare.mockClear();
    await s.dispatch(sortTabsBySite(W));
    expect(mocks.prepare).toHaveBeenLastCalledWith(['pane:detail'], 'reorder');
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    await backAndAgain(s, 'pane:detail', 'reorder');
  });

  test('Sort groups by name: the same', async () => {
    const s = store();
    await s.dispatch(sortWindowGroupsByName({ ...W, locale: 'en' }));
    expect(mocks.prepare).toHaveBeenLastCalledWith(['pane:detail'], 'reorder');
    await backAndAgain(s, 'pane:detail', 'reorder');
  });

  test('the sessions sort: the sessions list reorders, and back to Date edited', async () => {
    const s = store();
    await s.dispatch(sortSessions({ by: 'name', locale: 'en' }));
    expect(mocks.prepare).toHaveBeenLastCalledWith(
      ['pane:sessions'],
      'reorder'
    );
    await backAndAgain(s, 'pane:sessions', 'reorder');
    mocks.prepare.mockClear();
    await s.dispatch(resetSessionOrder());
    expect(mocks.prepare).toHaveBeenLastCalledWith(
      ['pane:sessions'],
      'reorder'
    );
  });

  test('Ungroup and End split view: the detail pane reorders', async () => {
    const s = store();
    await s.dispatch(ungroupSavedGroup({ ...W, groupId: 'gz' }));
    expect(mocks.prepare).toHaveBeenLastCalledWith(['pane:detail'], 'reorder');
    await backAndAgain(s, 'pane:detail', 'reorder');

    await s.dispatch(endSavedSplit({ ...W, tabId: 'h1' }));
    expect(mocks.prepare).toHaveBeenLastCalledWith(['pane:detail'], 'reorder');
    await backAndAgain(s, 'pane:detail', 'reorder');
  });

  test('Remove duplicate tabs: a delete that lights up the kept copy; undo lights what comes back, redo the kept copy again', async () => {
    const s = store();
    await s.dispatch(removeDuplicateTabs({ tabGroupId: 's1', within: W }));
    expect(mocks.prepare).toHaveBeenLastCalledWith(
      ['pane:detail'],
      'delete',
      'this page',
      { light: ['a1'] }
    );
    await s.dispatch(undoStep());
    expect(mocks.prepare).toHaveBeenLastCalledWith(
      ['pane:detail'],
      'delete',
      'undo or redo',
      { lightReturns: true }
    );
    await s.dispatch(redoStep());
    expect(mocks.prepare).toHaveBeenLastCalledWith(
      ['pane:detail'],
      'delete',
      'undo or redo',
      { light: ['a1'] }
    );
  });

  test('nothing to sort or remove asks for no glide', async () => {
    const s = store();
    await s.dispatch(sortTabsBySite(W));
    mocks.prepare.mockClear();
    await s.dispatch(sortTabsBySite(W));
    await s.dispatch(removeDuplicateTabs({ tabGroupId: 's2' }));
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
