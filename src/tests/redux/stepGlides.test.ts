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
import { noteAddStep, prepareStepGlide } from '../../redux/stepGlides';
import { carryToNewSession } from '../../redux/commitCarry';
import { liveItem } from '../../redux/carriedItem';
import { live } from '../fixtures/liveSnapshotFixture';
import {
  addCurrTabToChromeGroup,
  addCurrTabToWindow,
  addCurrWindowToTabGroup,
  replaceState,
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

describe('undo and redo of an add', () => {
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
    expect(mocks.prepare).toHaveBeenLastCalledWith(['pane:detail'], 'delete');
    await store.dispatch(redoStep());
    expect(mocks.prepare).toHaveBeenLastCalledWith(['pane:detail'], 'arrive');
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
    expect(mocks.prepare).toHaveBeenLastCalledWith(['pane:detail'], 'delete');
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
    expect(mocks.prepare).toHaveBeenLastCalledWith(['pane:detail'], 'delete');
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
    expect(mocks.prepare).toHaveBeenLastCalledWith(['pane:sessions'], 'delete');
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

describe('noteAddStep', () => {
  test('a null step (no step was recorded) is not noted', () => {
    noteAddStep(null, 'sessions');
    prepareStepGlide(undefined, 'undo');
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  test('keeps the newest 200 notes: the oldest is let go first', () => {
    const base = 1_000_000;
    for (let i = 0; i <= 200; i++) noteAddStep(base + i, 'sessions');

    prepareStepGlide(base, 'undo');
    expect(mocks.prepare).not.toHaveBeenCalled();
    prepareStepGlide(base + 1, 'undo');
    expect(mocks.prepare).toHaveBeenLastCalledWith(['pane:sessions'], 'delete');
  });
});
