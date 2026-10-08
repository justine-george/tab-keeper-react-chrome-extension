import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
  });
});

const firestore = vi.hoisted(() => ({
  setDoc: vi.fn<(ref: unknown, data: TabMasterContainer) => Promise<void>>(),
  getDoc: vi.fn(),
}));

vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInAnonymously: vi.fn(),
}));
vi.mock('firebase/firestore/lite', () => ({
  doc: vi.fn(() => ({})),
  getFirestore: vi.fn(() => ({})),
  getDoc: firestore.getDoc,
  setDoc: firestore.setDoc,
}));

vi.mock('../../utils/functions/external', async (importActual) => ({
  ...(await importActual<typeof import('../../utils/functions/external')>()),
  loadFromFirestore: vi.fn(async () => undefined),
  displayToast: vi.fn(),
}));

import reducer, {
  moveToSessionInternal,
  replaceState,
  updateTabGroupTitle,
  type TabMasterContainer,
  type tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { saveToFirestore } from '../../utils/functions/external';
import { mergeTabContainers } from '../../utils/functions/mergeTabData';
import { fetchDataFromFirestore } from '../../config/firebase';
import {
  isValidTabMasterContainer,
  readImportedContainer,
} from '../../utils/functions/local';
import {
  T0,
  container,
  group,
  session,
  sessionIn,
  tab,
  win,
  windowIn,
} from '../fixtures/sessionMoveFixture';

// KAN-460 D6. Device A saves a collapsed group; another device, or an older writer, must not cost it silently.
const savedOnA = (): tabContainerData =>
  session('S', 'Trip', T0 - 60_000, [
    win(
      'w',
      [tab('a1', 'g1'), tab('b1', 'g2'), tab('c')],
      [{ ...group('g1'), collapsed: true }, group('g2')]
    ),
  ]);
const deviceWith = (s: tabContainerData): TabMasterContainer =>
  reducer(undefined, replaceState(container([s])));
const collapsedOf = (c: TabMasterContainer) =>
  (windowIn(c, 'S', 'w').chromeTabGroups ?? []).map((g) => g.collapsed);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a collapsed group across two devices (KAN-460)', () => {
  it('B renames the session A saved: the collapsed group survives the merge', () => {
    const a = deviceWith(savedOnA());
    vi.setSystemTime(T0 + 2_000);
    const cloud = reducer(
      deviceWith(savedOnA()),
      updateTabGroupTitle({ tabGroupId: 'S', editableTitle: 'Renamed on B' })
    );

    const { merged } = mergeTabContainers(a, cloud, T0 + 3_000);

    expect(sessionIn(merged, 'S').title).toBe('Renamed on B');
    expect(collapsedOf(merged)).toEqual([true, undefined]);
  });

  it("an older writer's later copy wins without the field", () => {
    const a = deviceWith(savedOnA());
    const cloud = deviceWith({
      ...session('S', 'Edited by an older version', T0 - 60_000, [
        win(
          'w',
          [tab('a1', 'g1'), tab('b1', 'g2'), tab('c')],
          [group('g1'), group('g2')]
        ),
      ]),
      lastModified: T0 + 2_000,
    });

    const { merged } = mergeTabContainers(a, cloud, T0 + 3_000);

    expect(sessionIn(merged, 'S').title).toBe('Edited by an older version');
    expect(collapsedOf(merged)).toEqual([undefined, undefined]);
  });

  it('the real cloud write, read back by the real cloud read, keeps the field', async () => {
    firestore.setDoc.mockReset().mockResolvedValue(undefined);
    const data = deviceWith(savedOnA());
    await saveToFirestore('u1', data);
    const written = firestore.setDoc.mock.calls[0][1];
    firestore.getDoc.mockReset().mockResolvedValue({
      exists: () => true,
      data: () => written,
    });

    const back: unknown = await fetchDataFromFirestore('u1');

    expect(isValidTabMasterContainer(back)).toBe(true);
    if (!isValidTabMasterContainer(back)) return;
    expect(windowIn(back, 'S', 'w')).toEqual(windowIn(data, 'S', 'w'));
    expect(collapsedOf(back)).toEqual([true, undefined]);
  });

  it('moving the window to another session keeps the collapsed group', () => {
    const dest = session('D', 'Dest', T0 - 30_000, [
      win('d', [tab('x1', 'g1')], [group('g1')]),
    ]);
    const state = reducer(
      undefined,
      replaceState(container([savedOnA(), dest]))
    );

    const next = reducer(
      state,
      moveToSessionInternal(
        {
          carried: { kind: 'window', tabGroupId: 'S', windowId: 'w' },
          to: { tabGroupId: 'D', toIndex: 1 },
        },
        '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f'
      )
    );

    // g1 collides with the destination's g1, so it is re-minted on the way in.
    const groups = windowIn(next, 'D', 'w').chromeTabGroups ?? [];
    expect(groups[0].groupId).not.toBe('g1');
    expect(groups.map((g) => g.collapsed)).toEqual([true, undefined]);
  });

  it('the real cloud write sends the collapsed group', async () => {
    firestore.setDoc.mockReset().mockResolvedValue(undefined);

    await saveToFirestore('u1', deviceWith(savedOnA()));

    const written: TabMasterContainer = firestore.setDoc.mock.calls[0][1];
    expect(collapsedOf(written)).toEqual([true, undefined]);
  });

  it('a backup file keeps the field', () => {
    const loaded = readImportedContainer(
      JSON.stringify(deviceWith(savedOnA())),
      'en'
    );

    expect(collapsedOf(loaded)).toEqual([true, undefined]);
  });
});
