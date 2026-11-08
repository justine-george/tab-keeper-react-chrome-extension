// KAN-893. A saved tab, pair, group or window dropped into Currently open, as
// an undo step: what it opened and where, so undo can close exactly that, and
// what to open again, so redo works whatever became of the saved session.
import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';
import type { OpenNowDrop, TabPlace } from './openNowMoves';
import type { TabGroupSpec, WindowSpec } from './windows';

// One tab the drop opened: where it ended up, and the address it was opened with.
export interface OpenedTab {
  tabId: number;
  place: TabPlace;
  openedUrl: string;
  saved: tabData;
}

// Where redo opens the tabs again: a slot of a live window (into a live group
// when `groupId` is set), the end of an open window, or a new window in front.
export type ReopenAt =
  | { at: 'slot'; windowId: number; index: number; groupId: number | null }
  // Only the saved tabs the drop opened, with the window's groups.
  | { at: 'windowEnd'; windowId: number; spec: WindowSpec }
  | { at: 'newWindow'; spec: WindowSpec };

export interface OpenedCopy {
  kind: 'opened';
  // In Chrome's order.
  tabs: OpenedTab[];
  // A group drop's look; null for anything else.
  group: TabGroupSpec | null;
  // The window a New window drop made, with the pinned Tab Keeper tab it added.
  madeWindow: { windowId: number; stubTabId: number | null } | null;
  reopen: ReopenAt;
  // The placeholders' words, as the drop made them: redo makes them again.
  goToURLText: string;
}

export type LiveDrop = OpenNowDrop | OpenedCopy;

export function isOpenedCopy(drop: LiveDrop): drop is OpenedCopy {
  return drop.kind === 'opened';
}

// Old Chrome id → new, per kind: tab, window and group ids are counted apart.
// Pairs, not Maps, so a redo's reply stays plain data in the store.
export interface RenamedIds {
  tabs: readonly (readonly [number, number])[];
  windows: readonly (readonly [number, number])[];
  groups: readonly (readonly [number, number])[];
}

const renamer = (pairs: RenamedIds[keyof RenamedIds]) => {
  const map = new Map(pairs);
  return (id: number) => map.get(id) ?? id;
};

// Every id in the step, old → new; an id not renamed stays. A redo of a drop
// opens new tabs (and a new window or group), so later steps that name the
// old ones still find theirs (spec "Redo").
export function renameIds(drop: LiveDrop, renamed: RenamedIds): LiveDrop {
  const tab = renamer(renamed.tabs);
  const win = renamer(renamed.windows);
  const group = renamer(renamed.groups);
  const place = (p: TabPlace): TabPlace => ({
    ...p,
    windowId: win(p.windowId),
    groupId: group(p.groupId),
  });
  if (!isOpenedCopy(drop)) {
    return {
      ...drop,
      moved: drop.moved.map((m) => ({
        tabId: tab(m.tabId),
        before: place(m.before),
        after: place(m.after),
      })),
      ...(drop.pagesBefore && {
        pagesBefore: drop.pagesBefore.map((p) => ({
          ...p,
          tabId: tab(p.tabId),
        })),
      }),
      ...(drop.madeWindow !== undefined && {
        madeWindow: win(drop.madeWindow),
      }),
    };
  }
  const { reopen, madeWindow } = drop;
  return {
    ...drop,
    tabs: drop.tabs.map((t) => ({
      ...t,
      tabId: tab(t.tabId),
      place: place(t.place),
    })),
    madeWindow: madeWindow && {
      windowId: win(madeWindow.windowId),
      stubTabId:
        madeWindow.stubTabId === null ? null : tab(madeWindow.stubTabId),
    },
    reopen:
      reopen.at === 'slot'
        ? {
            ...reopen,
            windowId: win(reopen.windowId),
            groupId: reopen.groupId === null ? null : group(reopen.groupId),
          }
        : reopen.at === 'windowEnd'
          ? { ...reopen, windowId: win(reopen.windowId) }
          : reopen,
  };
}
