import { describe, expect, test, vi } from 'vitest';

// common.ts reads window.screen at module load, and this is a node test.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
  displayToast: vi.fn(),
}));

import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  deleteTabContainerInternal,
  deleteTabInternal,
  deleteWindowInternal,
  hydrateFromOtherPage,
  mergeSessionsFromBackupInternal,
  replaceState,
  restoreContainer,
  type TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { loadSessionsIntoPage } from '../../redux/slices/globalStateSlice';
import { mergeTabContainers } from '../../utils/functions/mergeTabData';
import {
  withASelection,
  withOwnSelection,
} from '../../utils/functions/withOwnSelection';
import { IS_DIRTY_ACTION, SET_ACTION } from '../../utils/constants/actionTypes';

// While the list has a session, one is selected. These pin every way in
// (load, merge, import, restore, another page) and the delete that takes the
// selected session out.

const AT = Date.UTC(2026, 8, 1, 9, 0, 0);
const session = (id: string) =>
  buildSession({
    tabGroupId: id,
    title: id,
    createdAt: AT,
    windows: [
      {
        ...buildSession().windows[0],
        windowId: `${id}-w`,
        tabs: [
          {
            tabId: `${id}-t`,
            favicon: '',
            title: id,
            url: `https://${id}.co/`,
          },
        ],
      },
    ],
  });

const container = (
  ids: string[],
  selectedTabGroupId: string | null
): TabMasterContainer => ({
  ...buildContainer(ids.map(session)),
  selectedTabGroupId,
  tabGroups: ids.map((id) => ({
    ...session(id),
    isSelected: id === selectedTabGroupId,
  })),
});

const flagged = (c: TabMasterContainer) =>
  c.tabGroups.filter((g) => g.isSelected).map((g) => g.tabGroupId);

const storeWith = (c: TabMasterContainer) => {
  const made = makeTestStore();
  made.store.dispatch(replaceState(c));
  made.seen.length = 0;
  return made;
};

const stateOf = (store: ReturnType<typeof makeTestStore>['store']) =>
  store.getState().tabContainerDataState;

describe('deleting the selected session selects the one that takes its place', () => {
  test('a middle session: the next one', () => {
    const { store } = storeWith(container(['a', 'b', 'c'], 'b'));

    store.dispatch(deleteTabContainerInternal('b'));

    expect(stateOf(store).selectedTabGroupId).toBe('c');
    expect(flagged(stateOf(store))).toEqual(['c']);
  });

  test('the first session: the new first', () => {
    const { store } = storeWith(container(['a', 'b', 'c'], 'a'));

    store.dispatch(deleteTabContainerInternal('a'));

    expect(stateOf(store).selectedTabGroupId).toBe('b');
    expect(flagged(stateOf(store))).toEqual(['b']);
  });

  test('the last session: the new last', () => {
    const { store } = storeWith(container(['a', 'b', 'c'], 'c'));

    store.dispatch(deleteTabContainerInternal('c'));

    expect(stateOf(store).selectedTabGroupId).toBe('b');
    expect(flagged(stateOf(store))).toEqual(['b']);
  });

  test('the only session: none, and the id is null', () => {
    const { store } = storeWith(container(['a'], 'a'));

    store.dispatch(deleteTabContainerInternal('a'));

    expect(stateOf(store).tabGroups).toEqual([]);
    expect(stateOf(store).selectedTabGroupId).toBeNull();
  });

  test('a session that is not selected leaves the selection alone', () => {
    const { store } = storeWith(container(['a', 'b', 'c'], 'c'));

    store.dispatch(deleteTabContainerInternal('a'));

    expect(stateOf(store).selectedTabGroupId).toBe('c');
    expect(flagged(stateOf(store))).toEqual(['c']);
  });

  test('emptying the selected session by its last window does the same', () => {
    const { store } = storeWith(container(['a', 'b', 'c'], 'b'));

    store.dispatch(deleteWindowInternal({ tabGroupId: 'b', windowId: 'b-w' }));

    expect(stateOf(store).tabGroups.map((g) => g.tabGroupId)).toEqual([
      'a',
      'c',
    ]);
    expect(stateOf(store).selectedTabGroupId).toBe('c');
    expect(flagged(stateOf(store))).toEqual(['c']);
  });

  test('emptying the selected session by its last tab does the same', () => {
    const { store } = storeWith(container(['a', 'b', 'c'], 'c'));

    store.dispatch(
      deleteTabInternal({ tabGroupId: 'c', windowId: 'c-w', tabId: 'c-t' })
    );

    expect(stateOf(store).selectedTabGroupId).toBe('b');
    expect(flagged(stateOf(store))).toEqual(['b']);
  });
});

describe('a container taken in with no usable selection selects the first session', () => {
  const dangling = [
    ['a null id', null],
    ['an id naming a session that is gone', 'gone'],
  ] as const;

  describe.each(dangling)('with %s', (_label, id) => {
    const incoming = () => container(['a', 'b', 'c'], id);

    const expectFirst = (c: TabMasterContainer) => {
      expect(c.selectedTabGroupId).toBe('a');
      expect(flagged(c)).toEqual(['a']);
    };

    test('replaceState (the sync and startup load)', () => {
      const { store } = makeTestStore();
      store.dispatch(replaceState(incoming()));
      expectFirst(stateOf(store));
    });

    test('hydrateFromOtherPage', () => {
      const { store } = makeTestStore();
      store.dispatch(hydrateFromOtherPage(incoming()));
      expectFirst(stateOf(store));
    });

    test('loadSessionsIntoPage, over the placeholder and after it', () => {
      const first = makeTestStore();
      first.store.dispatch(loadSessionsIntoPage(incoming()));
      expectFirst(stateOf(first.store));

      const later = makeTestStore();
      later.store.dispatch(replaceState(container(['z'], 'z')));
      later.store.dispatch(loadSessionsIntoPage(incoming()));
      expectFirst(stateOf(later.store));
    });

    test('restoreContainer (import, Replace)', () => {
      const { store } = makeTestStore();
      store.dispatch(restoreContainer(incoming()));
      expectFirst(stateOf(store));
    });

    test('mergeTabContainers, whichever side the dangling id came from', () => {
      const merged = mergeTabContainers(
        incoming(),
        container(['b'], 'b'),
        AT
      ).merged;
      expect(merged.selectedTabGroupId).toBe(merged.tabGroups[0].tabGroupId);
      expect(flagged(merged)).toEqual([merged.tabGroups[0].tabGroupId]);
    });

    test('withOwnSelection, with the page own id dangling', () => {
      expectFirst(withOwnSelection(container(['a', 'b'], 'b'), id));
    });
  });

  test('mergeSessionsFromBackupInternal onto an empty, unselected list', () => {
    const { store } = makeTestStore();
    store.dispatch(
      mergeSessionsFromBackupInternal(container(['a', 'b'], null))
    );
    expect(stateOf(store).selectedTabGroupId).toBe('a');
    expect(flagged(stateOf(store))).toEqual(['a']);
  });

  test('a valid selection is kept, not replaced by the first', () => {
    const { store } = makeTestStore();
    store.dispatch(replaceState(container(['a', 'b', 'c'], 'c')));
    expect(stateOf(store).selectedTabGroupId).toBe('c');
    expect(flagged(stateOf(store))).toEqual(['c']);
  });

  test('an empty list stays unselected', () => {
    const { store } = makeTestStore();
    store.dispatch(replaceState(container([], null)));
    expect(stateOf(store).selectedTabGroupId).toBeNull();
  });

  test('a stale isSelected flag is corrected to agree with the id', () => {
    const wrong = container(['a', 'b'], 'a');
    wrong.tabGroups[1].isSelected = true;
    const { store } = makeTestStore();
    store.dispatch(replaceState(wrong));
    expect(flagged(stateOf(store))).toEqual(['a']);
  });
});

describe('the fix-up is view state: no sync, no undo step, no timestamp', () => {
  const dispatchers: [
    string,
    (s: ReturnType<typeof makeTestStore>['store']) => void,
  ][] = [
    [
      'replaceState',
      (s) => void s.dispatch(replaceState(container(['a', 'b'], null))),
    ],
    [
      'hydrateFromOtherPage',
      (s) =>
        void s.dispatch(hydrateFromOtherPage(container(['a', 'b'], 'gone'))),
    ],
    [
      'loadSessionsIntoPage',
      (s) => void s.dispatch(loadSessionsIntoPage(container(['a', 'b'], null))),
    ],
  ];

  test.each(dispatchers)('%s', (_name, run) => {
    const { store, seen } = makeTestStore();
    const incoming = container(['a', 'b'], null);
    const incomingModified = incoming.lastModified;

    run(store);

    // CONTROL: the fix-up ran, so the assertions below are about it.
    expect(stateOf(store).selectedTabGroupId).toBe('a');
    expect(seen).not.toContain(IS_DIRTY_ACTION);
    expect(seen).not.toContain(SET_ACTION);
    expect(store.getState().undoRedo.past).toEqual([]);
    expect(store.getState().globalState.isDirty).toBe(false);
    expect(stateOf(store).lastModified).toBe(incomingModified);
    expect(stateOf(store).tabGroups.map((g) => g.lastModified)).toEqual([
      undefined,
      undefined,
    ]);
  });

  test('mergeTabContainers leaves lastModified and the sessions timestamps as the merge set them', () => {
    const local = container(['a', 'b'], null);
    const cloud = container(['a', 'b'], null);
    const { merged } = mergeTabContainers(local, cloud, AT);
    expect(merged.lastModified).toBe(
      Math.max(local.lastModified, cloud.lastModified)
    );
    expect(merged.selectedTabGroupId).toBe(merged.tabGroups[0].tabGroupId);
  });

  test('a CONTROL: a content delete does mark the store dirty', () => {
    const { store, seen } = storeWith(container(['a', 'b'], 'a'));
    store.dispatch(deleteTabContainerInternal('a'));
    expect(seen).toContain(IS_DIRTY_ACTION);
  });
});

describe('withASelection', () => {
  test('returns the same object when it already agrees', () => {
    const c = container(['a', 'b'], 'b');
    expect(withASelection(c)).toBe(c);
  });
});
