import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
  });
});

const firestore = vi.hoisted(() => ({
  setDoc: vi.fn<(ref: unknown, data: TabMasterContainer) => Promise<void>>(),
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
  getDoc: vi.fn(),
  setDoc: firestore.setDoc,
}));

vi.mock('../../utils/functions/external', async (importActual) => ({
  ...(await importActual<typeof import('../../utils/functions/external')>()),
  loadFromFirestore: vi.fn(async () => undefined),
  displayToast: vi.fn(),
}));

import reducer, {
  replaceState,
  updateTabGroupTitle,
  type TabMasterContainer,
  type tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { saveToFirestore } from '../../utils/functions/external';
import { mergeTabContainers } from '../../utils/functions/mergeTabData';
import {
  compressToBytes,
  decompressFromBytes,
} from '../../utils/functions/compression';
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

  it('the cloud write and read keep the field', async () => {
    const data = deviceWith(savedOnA());
    const back: unknown = JSON.parse(
      await decompressFromBytes(await compressToBytes(JSON.stringify(data)))
    );

    expect(isValidTabMasterContainer(back)).toBe(true);
    if (!isValidTabMasterContainer(back)) return;
    expect(windowIn(back, 'S', 'w')).toEqual(windowIn(data, 'S', 'w'));
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
