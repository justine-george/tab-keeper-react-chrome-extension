import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

const mocks = vi.hoisted(() => ({ prepare: vi.fn() }));

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
  ensureCloudSessionReady: vi.fn(async () => undefined),
}));

// What the glide was asked to measure; the drawing is a browser's (e2e/edit-reorder-*.spec.ts).
vi.mock('../../components/common/layoutGlide', () => ({
  panes: (name: string) => [`pane:${name}`],
  prepareLayoutGlide: mocks.prepare,
}));

import { loadSessionsIntoPage } from '../../redux/slices/globalStateSlice';
import { updateTabGroupTitle } from '../../redux/slices/tabContainerDataStateSlice';
import { applyOtherPageSessions } from '../../redux/otherPageChanges';
import { beginDragHold, endDragHold } from '../../redux/dragHold';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-994. Who asked for a reorder glide, and when nothing does: an edit here
// glides even mid-drop (a drop is committed while its row is held); another
// page's or the sync's reorder glides as from elsewhere, but never while a
// row is held or as a change that waited for the release lands (KAN-991).

const T0 = Date.UTC(2026, 10, 23, 12);
const session = (id: string, contentModified: number) =>
  buildSession({ tabGroupId: id, title: id, contentModified });
const THIS_PAGE = [
  ['pane:sessions'],
  'reorder',
  'this page',
  { alongside: true },
];
const ELSEWHERE = [
  ['pane:sessions'],
  'reorder',
  'elsewhere',
  { alongside: true },
];
const reorders = () =>
  mocks.prepare.mock.calls.filter((c) => c[1] === 'reorder');

function openPage() {
  const made = makeTestStore();
  made.store.dispatch(
    loadSessionsIntoPage(
      buildContainer([session('a', T0 - 1000), session('b', T0 - 2000)])
    )
  );
  mocks.prepare.mockClear();
  return made.store;
}
// Another page edited b, so b is first there.
const otherPageEditedB = () =>
  localStorage.setItem(
    'tabContainerData',
    JSON.stringify(buildContainer([session('b', T0), session('a', T0 - 1000)]))
  );

beforeEach(() => {
  localStorage.clear();
  mocks.prepare.mockClear();
});
afterEach(() => endDragHold());

describe('a reorder glide', () => {
  test('an edit here asks, from this page', () => {
    const store = openPage();
    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 'b', editableTitle: 'B' })
    );
    expect(reorders()).toEqual([THIS_PAGE]);
  });

  test('an edit here while its own row is held (a drop) still asks', () => {
    const store = openPage();
    beginDragHold();
    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 'b', editableTitle: 'B' })
    );
    expect(reorders()).toEqual([THIS_PAGE]);
  });

  test("another page's edit asks, from elsewhere", () => {
    const store = openPage();
    otherPageEditedB();
    store.dispatch(applyOtherPageSessions());
    expect(reorders()).toEqual([ELSEWHERE]);
  });

  test("another page's edit that waited for a held row lands with the release, still", () => {
    const store = openPage();
    beginDragHold();
    otherPageEditedB();
    store.dispatch(applyOtherPageSessions());
    endDragHold();
    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    ).toEqual(['b', 'a']);
    expect(reorders()).toEqual([]);
  });
});
