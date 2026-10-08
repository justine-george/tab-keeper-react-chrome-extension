import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
  });
});

const firestore = vi.hoisted(() => ({ setDoc: vi.fn() }));

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
  type tabData,
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
import { restoreTargetIndex } from '../../utils/functions/windows';
import {
  T0,
  container,
  session,
  sessionIn,
  tab,
  win,
  windowIn,
} from '../fixtures/sessionMoveFixture';

// KAN-458 A3. Device A saves pins and an active tab; another device, or an older writer, must not cost them silently.
const pinned = (tabId: string): tabData => ({ ...tab(tabId), pinned: true });
const savedOnA = (): tabContainerData =>
  session('S', 'Trip', T0 - 60_000, [
    {
      ...win('w', [pinned('p1'), tab('a2'), tab('b3')]),
      activeTabId: 'a2',
    },
  ]);
const deviceWith = (s: tabContainerData): TabMasterContainer =>
  reducer(undefined, replaceState(container([s])));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pinned tabs and the active tab across two devices (KAN-458)', () => {
  it('B renames the session A saved: the pin and the active tab survive the merge', () => {
    const a = deviceWith(savedOnA());
    vi.setSystemTime(T0 + 2_000);
    const cloud = reducer(
      deviceWith(savedOnA()),
      updateTabGroupTitle({ tabGroupId: 'S', editableTitle: 'Renamed on B' })
    );

    const { merged } = mergeTabContainers(a, cloud, T0 + 3_000);

    expect(sessionIn(merged, 'S').title).toBe('Renamed on B');
    const w = windowIn(merged, 'S', 'w');
    expect(w.tabs.map((t) => t.pinned)).toEqual([true, undefined, undefined]);
    expect(w.activeTabId).toBe('a2');
  });

  it("an older writer's later copy wins without the fields, and restore falls back to the first tab", () => {
    const a = deviceWith(savedOnA());
    const cloud = deviceWith({
      ...session('S', 'Edited by an older version', T0 - 60_000, [
        win('w', [tab('p1'), tab('a2'), tab('b3')]),
      ]),
      lastModified: T0 + 2_000,
    });

    const { merged } = mergeTabContainers(a, cloud, T0 + 3_000);

    const w = windowIn(merged, 'S', 'w');
    expect(sessionIn(merged, 'S').title).toBe('Edited by an older version');
    expect(w.tabs.some((t) => 'pinned' in t)).toBe(false);
    expect('activeTabId' in w).toBe(false);
    expect(restoreTargetIndex(w.tabs, w.activeTabId)).toBe(0);
  });

  it('the cloud write and read keep both fields', async () => {
    const data = deviceWith(savedOnA());
    const back: unknown = JSON.parse(
      await decompressFromBytes(await compressToBytes(JSON.stringify(data)))
    );

    expect(isValidTabMasterContainer(back)).toBe(true);
    if (!isValidTabMasterContainer(back)) return;
    expect(windowIn(back, 'S', 'w')).toEqual(windowIn(data, 'S', 'w'));
  });

  it('the real cloud write sends the pin and the active tab', async () => {
    firestore.setDoc.mockReset().mockResolvedValue(undefined);

    await saveToFirestore('u1', deviceWith(savedOnA()));

    const written: TabMasterContainer = firestore.setDoc.mock.calls[0][1];
    const w = windowIn(written, 'S', 'w');
    expect(w.tabs.map((t) => t.pinned)).toEqual([true, undefined, undefined]);
    expect(w.activeTabId).toBe('a2');
  });

  it('a backup file keeps both fields', () => {
    const loaded = readImportedContainer(
      JSON.stringify(deviceWith(savedOnA())),
      'en'
    );

    expect(windowIn(loaded, 'S', 'w').tabs[0].pinned).toBe(true);
    expect(windowIn(loaded, 'S', 'w').activeTabId).toBe('a2');
  });
});
