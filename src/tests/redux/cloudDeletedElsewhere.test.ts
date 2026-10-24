import { describe, it, expect, vi, beforeEach } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

const mocks = vi.hoisted(() => ({
  loadFromFirestore: vi.fn(async (): Promise<unknown> => undefined),
  saveToFirestore: vi.fn<(userId: string, data: unknown) => Promise<void>>(
    async () => undefined
  ),
  cloudDocumentExists: vi.fn(async (): Promise<boolean> => false),
}));

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: mocks.loadFromFirestore,
  saveToFirestore: mocks.saveToFirestore,
  cloudDocumentExists: mocks.cloudDocumentExists,
  ensureCloudSessionReady: vi.fn(async () => undefined),
}));

import {
  mergeSessionsFromBackup,
  setFirebaseAuthed,
  setSignedIn,
  setUserId,
  syncNowWhenSignedIn,
  syncStateWithFirestore,
  turnSyncBackOn,
} from '../../redux/slices/globalStateSlice';
import {
  declineCloudConsent,
  grantCloudConsent,
  hasSyncedSinceConsent,
  setAutoSync,
  setLastSyncedTime,
  type SettingsData,
} from '../../redux/slices/settingsDataStateSlice';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-759. Every device shares one cloud document. Delete cloud data on one
// device deleted it, and the next sync on any other device read "no document"
// as an empty cloud and uploaded its whole copy, so the delete did not stick.
// A device that has synced since its last yes, and then finds no document,
// knows another device deleted it: it stops, turns sync off here and says so.

const settle = () => new Promise((r) => setTimeout(r, 20));

const local = buildContainer([buildSession({ tabGroupId: 'b1' })]);
const cloud = buildContainer([buildSession({ tabGroupId: 'c1' })]);

// Signed in, with a yes given at `grantedAt` and a sync landed at `syncedAt`.
function device({
  grantedAt,
  syncedAt,
  autoSync = true,
}: {
  grantedAt: number;
  syncedAt: number | '';
  autoSync?: boolean;
}) {
  const made = makeTestStore();
  const { store } = made;
  store.dispatch(setUserId('u1'));
  store.dispatch(setSignedIn());
  store.dispatch(setFirebaseAuthed());
  vi.setSystemTime(grantedAt);
  store.dispatch(grantCloudConsent());
  store.dispatch(setAutoSync(autoSync));
  store.dispatch(setLastSyncedTime(syncedAt));
  vi.setSystemTime(Date.UTC(2026, 9, 24, 12));
  made.seen.length = 0;
  return made;
}

const SYNCED_SINCE = { grantedAt: 1000, syncedAt: 2000 };

describe('hasSyncedSinceConsent', () => {
  const settings = (s: Partial<SettingsData>) => s as SettingsData;
  it('is true once a sync lands after the yes', () => {
    expect(
      hasSyncedSinceConsent(
        settings({ cloudConsentGrantedAt: 1000, lastSyncedTime: 2000 })
      )
    ).toBe(true);
  });
  it('is false right after a yes, and with no sync at all', () => {
    expect(
      hasSyncedSinceConsent(
        settings({ cloudConsentGrantedAt: 3000, lastSyncedTime: 2000 })
      )
    ).toBe(false);
    expect(
      hasSyncedSinceConsent(
        settings({ cloudConsentGrantedAt: '', lastSyncedTime: '' })
      )
    ).toBe(false);
  });
  // An older build never stamped the yes: a landed sync is enough.
  it('is true for a device that synced before the yes was stamped', () => {
    expect(
      hasSyncedSinceConsent(
        settings({ cloudConsentGrantedAt: '', lastSyncedTime: 2000 })
      )
    ).toBe(true);
  });
});

describe('a device that finds its cloud copy deleted elsewhere (KAN-759)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    localStorage.clear();
    localStorage.setItem('tabContainerData', JSON.stringify(local));
    mocks.loadFromFirestore.mockReset().mockResolvedValue(undefined);
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
    mocks.cloudDocumentExists.mockReset().mockResolvedValue(false);
  });

  it('stops instead of uploading, turns sync off here and opens the notice', async () => {
    const { store } = device(SYNCED_SINCE);
    await store.dispatch(syncStateWithFirestore());
    await settle();

    expect(mocks.saveToFirestore).not.toHaveBeenCalled();
    const { settingsDataState, globalState } = store.getState();
    expect(settingsDataState.cloudConsent).toBe('declined');
    expect(settingsDataState.isAutoSync).toBe(false);
    expect(settingsDataState.cloudDeletedElsewhere).toEqual({
      wasAutoSync: true,
    });
    expect(globalState.isCloudDeletedNoticeOpen).toBe(true);
    expect(globalState.syncStatus).toBe('idle');
    // This device's sessions are untouched.
    expect(JSON.parse(localStorage.getItem('tabContainerData')!)).toEqual(
      local
    );
  });

  it('stops too with nothing saved here, rather than writing an empty copy', async () => {
    localStorage.removeItem('tabContainerData');
    const { store } = device(SYNCED_SINCE);
    await store.dispatch(syncStateWithFirestore());
    await settle();
    expect(mocks.saveToFirestore).not.toHaveBeenCalled();
    expect(store.getState().globalState.isCloudDeletedNoticeOpen).toBe(true);
  });

  it('stops on a pressed sync as well', async () => {
    const { store } = device({ ...SYNCED_SINCE, autoSync: false });
    await store.dispatch(syncNowWhenSignedIn());
    await settle();
    expect(mocks.saveToFirestore).not.toHaveBeenCalled();
    expect(store.getState().settingsDataState.cloudDeletedElsewhere).toEqual({
      wasAutoSync: false,
    });
  });

  // CONTROL: the stop is about a missing document, not about any sync.
  it('merges as before when the document is there', async () => {
    mocks.loadFromFirestore.mockResolvedValue(cloud);
    const { store } = device(SYNCED_SINCE);
    await store.dispatch(syncStateWithFirestore());
    await settle();
    expect(mocks.saveToFirestore).toHaveBeenCalledTimes(1);
    expect(store.getState().globalState.isCloudDeletedNoticeOpen).toBe(false);
    expect(store.getState().settingsDataState.cloudConsent).toBe('granted');
  });

  it('uploads on the first sync after a yes', async () => {
    const { store } = device({ grantedAt: 3000, syncedAt: 2000 });
    await store.dispatch(syncStateWithFirestore());
    await settle();
    expect(mocks.saveToFirestore).toHaveBeenCalledTimes(1);
    expect(store.getState().globalState.isCloudDeletedNoticeOpen).toBe(false);
  });

  it('uploads on a device that has never synced', async () => {
    const { store } = device({ grantedAt: 1000, syncedAt: '' });
    await store.dispatch(syncStateWithFirestore());
    await settle();
    expect(mocks.saveToFirestore).toHaveBeenCalledTimes(1);
  });

  describe('turnSyncBackOn', () => {
    it.each([true, false])(
      'gives the yes, puts Auto sync back to %s and uploads this device’s copy',
      async (wasAutoSync) => {
        const { store } = device({ ...SYNCED_SINCE, autoSync: wasAutoSync });
        await store.dispatch(syncStateWithFirestore());
        await settle();
        expect(mocks.saveToFirestore).not.toHaveBeenCalled();

        vi.setSystemTime(Date.UTC(2026, 9, 24, 13));
        await store.dispatch(turnSyncBackOn());
        await settle();
        const { settingsDataState, globalState } = store.getState();
        expect(settingsDataState.cloudConsent).toBe('granted');
        expect(settingsDataState.isAutoSync).toBe(wasAutoSync);
        expect(settingsDataState.cloudDeletedElsewhere).toBeNull();
        expect(globalState.isCloudDeletedNoticeOpen).toBe(false);
        expect(mocks.saveToFirestore).toHaveBeenCalledTimes(1);
      }
    );
  });

  // Any yes clears the record: the card stops saying the copy was deleted.
  it('a yes from the cloud question clears it too', async () => {
    const { store } = device(SYNCED_SINCE);
    await store.dispatch(syncStateWithFirestore());
    await settle();
    store.dispatch(grantCloudConsent());
    expect(store.getState().settingsDataState.cloudDeletedElsewhere).toBeNull();
  });

  // CONTROL for the record: declining on its own does not set it.
  it('declining the cloud question does not set it', () => {
    const { store } = device(SYNCED_SINCE);
    store.dispatch(declineCloudConsent());
    expect(store.getState().settingsDataState.cloudDeletedElsewhere).toBeNull();
  });

  describe('a backup load, which writes without a sync read', () => {
    const backup = buildContainer([buildSession({ tabGroupId: 'k1' })]);

    it('checks the document first, and stops when it is gone', async () => {
      const { store } = device(SYNCED_SINCE);
      await store.dispatch(mergeSessionsFromBackup(backup));
      await settle();
      expect(mocks.cloudDocumentExists).toHaveBeenCalledWith('u1');
      expect(mocks.saveToFirestore).not.toHaveBeenCalled();
      expect(store.getState().globalState.isCloudDeletedNoticeOpen).toBe(true);
      // The load itself went through on this device.
      expect(
        store
          .getState()
          .tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
      ).toContain('k1');
    });

    // CONTROL: with the document there, the write goes ahead as before.
    it('writes as before when the document is there', async () => {
      mocks.cloudDocumentExists.mockResolvedValue(true);
      const { store } = device(SYNCED_SINCE);
      await store.dispatch(mergeSessionsFromBackup(backup));
      await settle();
      expect(mocks.saveToFirestore).toHaveBeenCalledTimes(1);
      expect(store.getState().globalState.isCloudDeletedNoticeOpen).toBe(false);
    });
  });
});
