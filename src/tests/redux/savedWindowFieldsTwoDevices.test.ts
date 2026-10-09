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
  session,
  sessionIn,
  tab,
  win,
  windowIn,
} from '../fixtures/sessionMoveFixture';

// KAN-460 D6. Device A saves a full-screen, a maximized incognito and a plain window; another device, or an older writer, must not cost them silently.
const savedOnA = (): tabContainerData =>
  session('S', 'Trip', T0 - 60_000, [
    { ...win('w1', [tab('a1')]), state: 'fullscreen' },
    { ...win('w2', [tab('b1')]), state: 'maximized', incognito: true },
    win('w3', [tab('c1')]),
  ]);
const deviceWith = (s: tabContainerData): TabMasterContainer =>
  reducer(undefined, replaceState(container([s])));
const fieldsOf = (c: TabMasterContainer, id = 'S') =>
  sessionIn(c, id).windows.map((w) => [w.state, w.incognito]);
const SAVED = [
  ['fullscreen', undefined],
  ['maximized', true],
  [undefined, undefined],
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('saved window state and incognito across two devices (KAN-460)', () => {
  it('B renames the session A saved: the fields survive the merge', () => {
    const a = deviceWith(savedOnA());
    vi.setSystemTime(T0 + 2_000);
    const cloud = reducer(
      deviceWith(savedOnA()),
      updateTabGroupTitle({ tabGroupId: 'S', editableTitle: 'Renamed on B' })
    );

    const { merged } = mergeTabContainers(a, cloud, T0 + 3_000);

    expect(sessionIn(merged, 'S').title).toBe('Renamed on B');
    expect(fieldsOf(merged)).toEqual(SAVED);
  });

  it("an older writer's later copy wins without the fields", () => {
    const a = deviceWith(savedOnA());
    const cloud = deviceWith({
      ...session('S', 'Edited by an older version', T0 - 60_000, [
        win('w1', [tab('a1')]),
        win('w2', [tab('b1')]),
        win('w3', [tab('c1')]),
      ]),
      lastModified: T0 + 2_000,
    });

    const { merged } = mergeTabContainers(a, cloud, T0 + 3_000);

    expect(sessionIn(merged, 'S').title).toBe('Edited by an older version');
    expect(fieldsOf(merged)).toEqual([
      [undefined, undefined],
      [undefined, undefined],
      [undefined, undefined],
    ]);
  });

  it('the real cloud write, read back by the real cloud read, keeps the fields', async () => {
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
    expect(fieldsOf(back)).toEqual(SAVED);
  });

  it('moving a window to another session keeps its state and incognito', () => {
    const dest = session('D', 'Dest', T0 - 30_000, [win('d', [tab('x1')])]);
    const state = reducer(
      undefined,
      replaceState(container([savedOnA(), dest]))
    );

    const next = reducer(
      state,
      moveToSessionInternal(
        {
          carried: { kind: 'window', tabGroupId: 'S', windowId: 'w2' },
          to: { tabGroupId: 'D', toIndex: 1 },
        },
        '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f'
      )
    );

    expect(windowIn(next, 'D', 'w2')).toMatchObject({
      state: 'maximized',
      incognito: true,
    });
  });

  it('a backup file keeps the fields', () => {
    const loaded = readImportedContainer(
      JSON.stringify(deviceWith(savedOnA())),
      'en'
    );

    expect(fieldsOf(loaded)).toEqual(SAVED);
  });
});
