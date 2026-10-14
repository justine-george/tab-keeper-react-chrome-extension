// KAN-595. Sessions deleted on this device, kept 30 days. Local only: never synced.
import type { tabContainerData } from '../../redux/slices/tabContainerDataStateSlice';
import { TOMBSTONE_TTL_MS } from './mergeTabData';

export const RECENTLY_DELETED_KEY = 'recentlyDeleted';
export const RECENTLY_DELETED_MAX = 100;

export interface DeletedSession {
  session: tabContainerData;
  deletedAt: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

const isDeletedSession = (v: unknown): v is DeletedSession =>
  isRecord(v) &&
  typeof v.deletedAt === 'number' &&
  isRecord(v.session) &&
  typeof v.session.tabGroupId === 'string' &&
  Array.isArray(v.session.windows);

// Storage is read back from disk, so anything malformed is dropped rather than trusted.
export function deletedSessionsFrom(value: unknown): DeletedSession[] {
  return Array.isArray(value) ? value.filter(isDeletedSession) : [];
}

const fresh = (e: DeletedSession, now: number) =>
  now - e.deletedAt <= TOMBSTONE_TTL_MS;

// Newest first; one entry per session; 30 days; 100 at most.
function withEntries(
  list: DeletedSession[],
  entries: DeletedSession[],
  now: number
): DeletedSession[] {
  const ids = new Set(entries.map((e) => e.session.tabGroupId));
  return [...entries, ...list.filter((e) => !ids.has(e.session.tabGroupId))]
    .filter((e) => fresh(e, now))
    .sort((a, b) => b.deletedAt - a.deletedAt)
    .slice(0, RECENTLY_DELETED_MAX);
}

export function withDeleted(
  list: DeletedSession[],
  sessions: tabContainerData[],
  now: number
): DeletedSession[] {
  return withEntries(
    list,
    sessions.map((session) => ({
      session: { ...session, isSelected: false },
      deletedAt: now,
    })),
    now
  );
}

// A live session is not shown: it was undone, restored, or brought back by sync.
// Its entry stays, so undoing a restore shows it again.
export function shownDeleted(
  list: DeletedSession[],
  liveIds: ReadonlySet<string>,
  now: number
): DeletedSession[] {
  return list.filter(
    (e) => fresh(e, now) && !liveIds.has(e.session.tabGroupId)
  );
}

export async function readDeleted(): Promise<DeletedSession[]> {
  return deletedSessionsFrom(
    (await chrome.storage.local.get(RECENTLY_DELETED_KEY))[RECENTLY_DELETED_KEY]
  );
}

const write = (list: DeletedSession[]) =>
  chrome.storage.local.set({ [RECENTLY_DELETED_KEY]: list });

// One change at a time in this page: each reads the list and writes it back,
// so two in flight would keep only the last write.
let queue: Promise<unknown> = Promise.resolve();
function serial(task: () => Promise<void>): Promise<void> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

// Entries spent by a session coming back (a restore, an undone delete), kept
// so this page's undo or redo can put them back as they were. A session that
// merely goes away again later (a move that empties it, a delete on another
// device) must not bring back its old entry.
const spent = new Map<string, DeletedSession>();

export function recordDeleted(
  sessions: tabContainerData[],
  now: number
): Promise<void> {
  if (sessions.length === 0) return Promise.resolve();
  return serial(async () => {
    for (const s of sessions) spent.delete(s.tabGroupId);
    await write(withDeleted(await readDeleted(), sessions, now));
  });
}

// These sessions are live again: their entries are spent.
export function spendDeleted(tabGroupIds: string[]): Promise<void> {
  if (tabGroupIds.length === 0) return Promise.resolve();
  const ids = new Set(tabGroupIds);
  return serial(async () => {
    const list = await readDeleted();
    const back = list.filter((e) => ids.has(e.session.tabGroupId));
    if (back.length === 0) return;
    for (const e of back) spent.set(e.session.tabGroupId, e);
    await write(list.filter((e) => !ids.has(e.session.tabGroupId)));
  });
}

// An undo or redo took these sessions away again: their entries go back as they were.
export function putBackDeleted(
  tabGroupIds: string[],
  now: number
): Promise<void> {
  if (tabGroupIds.length === 0) return Promise.resolve();
  // Looked up in the queue, not now: the spend it undoes may still be queued.
  return serial(async () => {
    const back = tabGroupIds.flatMap((id) => spent.get(id) ?? []);
    if (back.length === 0) return;
    for (const e of back) spent.delete(e.session.tabGroupId);
    await write(withEntries(await readDeleted(), back, now));
  });
}

export function emptyDeleted(): Promise<void> {
  return serial(() => chrome.storage.local.remove(RECENTLY_DELETED_KEY));
}
