import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

const mocks = vi.hoisted(() => {
  const cloud: { doc: unknown } = { doc: undefined };
  return {
    cloud,
    prepare: vi.fn(),
    loadFromFirestore: vi.fn(async (): Promise<unknown> => cloud.doc),
    saveToFirestore: vi.fn(
      async (_userId: string, data: unknown): Promise<void> => {
        cloud.doc = structuredClone(data);
      }
    ),
  };
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: mocks.loadFromFirestore,
  saveToFirestore: mocks.saveToFirestore,
  ensureCloudSessionReady: vi.fn(async () => undefined),
}));

// What the glide was asked to measure; the drawing itself is a browser's (e2e).
vi.mock('../../components/common/layoutGlide', () => ({
  panes: (name: string) => [`pane:${name}`],
  prepareLayoutGlide: mocks.prepare,
}));

import {
  loadSessionsIntoPage,
  setFirebaseAuthed,
  setSignedIn,
  setUserId,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';
import { grantCloudConsent } from '../../redux/slices/settingsDataStateSlice';
import { hydrateSessionsFromStorage } from '../../redux/otherPageChanges';
import { beginDragHold, endDragHold } from '../../redux/dragHold';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-991. A session that reaches this page from another page or device
// slides in as one saved here does. These pin WHEN the glide is asked for;
// how it draws is checked in a browser (e2e/arrivals-glide.spec.ts).

const T0 = Date.UTC(2026, 10, 23, 12, 0, 0);
const MIN = 60_000;
const session = (id: string, at = T0 - 10 * MIN) =>
  buildSession({ tabGroupId: id, title: id, createdAt: at, lastModified: at });
const ARRIVAL = [['pane:sessions'], 'arrive', 'elsewhere'];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
  mocks.prepare.mockClear();
  mocks.cloud.doc = undefined;
});
afterEach(() => {
  endDragHold();
  vi.useRealTimers();
});

// A page that has drawn its list once: its first load is done.
function openPage() {
  const made = makeTestStore();
  made.store.dispatch(
    loadSessionsIntoPage(buildContainer([session('a'), session('b')]))
  );
  return made;
}

describe('a load into the page', () => {
  test('the first load moves nothing: it draws the list', () => {
    openPage();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  test('a later load that brings a session glides it in, as from elsewhere', () => {
    const { store } = openPage();
    store.dispatch(
      loadSessionsIntoPage(
        buildContainer([session('n', T0), session('a'), session('b')])
      )
    );
    expect(mocks.prepare.mock.calls).toEqual([ARRIVAL]);
    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    ).toEqual(['n', 'a', 'b']);
  });

  test('a later load with no new session asks for nothing', () => {
    const { store } = openPage();
    store.dispatch(loadSessionsIntoPage(buildContainer([session('b')])));
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  test('while a row is held it asks for nothing', () => {
    const { store } = openPage();
    beginDragHold();
    store.dispatch(
      loadSessionsIntoPage(
        buildContainer([session('n', T0), session('a'), session('b')])
      )
    );
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});

describe('another open page', () => {
  test('a session it saved glides in here', () => {
    const { store } = openPage();
    localStorage.setItem(
      'tabContainerData',
      JSON.stringify(
        buildContainer([session('n', T0), session('a'), session('b')])
      )
    );
    store.dispatch(hydrateSessionsFromStorage());
    expect(mocks.prepare.mock.calls).toEqual([ARRIVAL]);
  });

  test('a rename there asks for nothing', () => {
    const { store } = openPage();
    localStorage.setItem(
      'tabContainerData',
      JSON.stringify(
        buildContainer([
          buildSession({ ...session('a'), title: 'renamed' }),
          session('b'),
        ])
      )
    );
    store.dispatch(hydrateSessionsFromStorage());
    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.title)
    ).toEqual(['renamed', 'b']);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});

describe('the sync', () => {
  test('a session saved on another device glides in when the merge lands', async () => {
    const made = makeTestStore();
    made.store.dispatch(setUserId('u1'));
    made.store.dispatch(setSignedIn());
    made.store.dispatch(setFirebaseAuthed());
    made.store.dispatch(grantCloudConsent());
    const local = buildContainer([session('a'), session('b')]);
    localStorage.setItem('tabContainerData', JSON.stringify(local));
    made.store.dispatch(loadSessionsIntoPage(local));
    mocks.cloud.doc = buildContainer([
      session('remote', T0 - MIN),
      session('a'),
      session('b'),
    ]);

    await made.store.dispatch(syncStateWithFirestore());

    expect(
      made.store
        .getState()
        .tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    ).toContain('remote');
    expect(mocks.prepare.mock.calls).toEqual([ARRIVAL]);
  });
});
