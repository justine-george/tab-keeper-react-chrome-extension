// What a drag in the Open now pane MEANS (KAN-280 Part E, spec O11–O11h).
//
// The engine is the saved sessions' (RowDragArea), and so is the geometry:
// where rows are, which band a pointer is over, and what a release there
// describes (useTabDropGeometry / useGroupDropGeometry). Three things differ,
// and they live here:
//
// - A drop becomes Chrome calls (openNowMoves.ts), never Redux or storage
//   (O11b). The list is not changed optimistically: the drag hold keeps
//   Open now's re-reads waiting until the release, and the re-read then
//   shows what Chrome did.
// - Where a held row may land in a window (landingRange): a pinned tab among
//   its window's pinned tabs, anything else below them (O11c).
// - Which windows take it at all (acceptsWindow): a pinned tab only its own
//   (K1), a row only windows of its own profile (O11d), and a group holding
//   the page this pane is on only its own (T1, O11h).
// - A drop that changed something is the one ⌘Z undoes next (O11f); a drop
//   in place is not an action at all (ledger R23).
//
// Both limits are asked on every pointer move, so each is a few map reads
// over tables built once per snapshot.
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { DragWindows } from '../rightpane/rowDrag/dropRules';
import { useGroupDropGeometry } from '../rightpane/useGroupDrop';
import { useTabDropGeometry } from '../rightpane/useTabDrop';
import type { OpenWindow } from '../../../utils/functions/openNow';
import {
  changedAnyPlace,
  moveOpenGroup,
  moveOpenTab,
  type MovedTabs,
  type OpenNowDrop,
} from '../../../utils/functions/openNowMoves';
import { storeOpenNowDrop } from '../../../redux/openNowMoveUndo';
import {
  itemIdOf,
  partitionTabsIntoItems,
} from '../../../utils/functions/tabGroups';

// Open now's two lists, named apart from the saved pane's `tabs` and `items`
// so a row can never join a list of the other pane.
export const OPEN_TABS_SCOPE = 'openTabs';
export const OPEN_ITEMS_SCOPE = 'openItems';

// chrome.tabGroups.TAB_GROUP_ID_NONE, spelled out: chrome.tabGroups is absent
// without the grant, and tab.groupId still reports -1 then.
const NO_GROUP = -1;

/**
 * The live windows as the drop geometry reads them: ids as strings, each
 * tab's pinned state and group, and each window's groups. Without the grant
 * there are no groups (O11e), even in a snapshot read while it was held.
 */
export function openDragWindows(
  windows: readonly OpenWindow[],
  hasTabGroups: boolean
): DragWindows {
  return windows.map((window) => ({
    windowId: String(window.id),
    tabs: window.tabs.map((tab) => ({
      tabId: String(tab.id),
      pinned: tab.pinned,
      ...(hasTabGroups && tab.groupId !== null
        ? { chromeGroupId: String(tab.groupId) }
        : {}),
    })),
    chromeTabGroups: hasTabGroups
      ? window.groups.map((group) => ({
          groupId: String(group.id),
          title: group.title,
          color: group.color,
        }))
      : [],
  }));
}

// Keeps a drop for ⌘Z when it changed some tab's window, index or group.
function keepForUndo(drop: OpenNowDrop): void {
  if (changedAnyPlace(drop.moved)) storeOpenNowDrop(drop);
}

// What a window shows, for landingRange: the engine counts only the rows a
// window DRAWS, and a folded window draws none (Task 5, 4958c2a).
interface Shown {
  tabs: number;
  items: number;
  pinned: number;
}
const NOTHING_SHOWN: Shown = { tabs: 0, items: 0, pinned: 0 };

// A row that can be held: which window it is in, whether it is a pinned
// tab, and the group it IS (a group row; undefined for a tab row).
interface Held {
  windowId: string;
  pinned: boolean;
  groupId: string | undefined;
}

type Range = { min: number; max: number };

// Where `held` may land in `windowId`, counted as the engine counts: among
// the rows the window shows, with the held row lifted out (RowDragArea's
// landingRange). Pinned tabs come first in a Chrome window, so the pinned run
// is the first `pinned` rows.
function rangeIn(
  held: Held | undefined,
  windowId: string | undefined,
  shown: Shown,
  rows: number
): Range {
  if (held === undefined || windowId === undefined) {
    return { min: 0, max: rows };
  }
  const own = held.windowId === windowId;
  const others = own && rows > 0 ? rows - 1 : rows;
  const pinnedOthers =
    own && held.pinned && shown.pinned > 0 ? shown.pinned - 1 : shown.pinned;
  return held.pinned
    ? { min: 0, max: pinnedOthers }
    : { min: pinnedOthers, max: others };
}

interface Options {
  // The snapshot the pane draws. Its identity is what the tables below are
  // built from, so it must stay the same object while the windows do.
  windows: readonly OpenWindow[];
  hasTabGroups: boolean;
  // The windows the pane has folded shut, by Chrome id.
  collapsedIds: ReadonlySet<number>;
  // Every move Chrome carried out, with each tab's place before and after
  // (openNowMoves' MovedTabs). A drop in place hands on a record whose
  // places are equal; a refused one hands on nothing.
  onMoved?: (moved: MovedTabs) => void;
}

/**
 * Everything the Open now pane's two drag areas need: the `tabs` list (a tab
 * at a time) and the `items` list (a whole group by its title row).
 */
export function useOpenNowDrop({
  windows,
  hasTabGroups,
  collapsedIds,
  onMoved,
}: Options) {
  const dragWindows = useMemo(
    () => openDragWindows(windows, hasTabGroups),
    [windows, hasTabGroups]
  );
  const { describeTabMove, ...tabGeometry } = useTabDropGeometry(
    dragWindows,
    hasTabGroups
  );
  const { describeGroupMove, ...itemGeometry } = useGroupDropGeometry(
    dragWindows,
    hasTabGroups
  );

  // Each window's shown rows and profile, and each row that can be held,
  // by the string ids the engine carries. Items are partitioned with the
  // function the geometry uses, so a group row here is a group row there.
  const tables = useMemo(() => {
    const shown = new Map<string, Shown>();
    const incognito = new Map<string, boolean>();
    const tabs = new Map<string, Held>();
    const items = new Map<string, Held>();
    for (const window of dragWindows) {
      const open = windows.find((w) => String(w.id) === window.windowId);
      if (open === undefined) continue;
      incognito.set(window.windowId, open.incognito);
      const partition = partitionTabsIntoItems(
        window.tabs,
        window.chromeTabGroups
      );
      shown.set(
        window.windowId,
        collapsedIds.has(open.id)
          ? NOTHING_SHOWN
          : {
              tabs: window.tabs.length,
              items: partition.length,
              pinned: window.tabs.filter((tab) => tab.pinned).length,
            }
      );
      for (const tab of window.tabs) {
        tabs.set(tab.tabId, {
          windowId: window.windowId,
          pinned: tab.pinned === true,
          groupId: undefined,
        });
      }
      for (const item of partition) {
        items.set(itemIdOf(item), {
          windowId: window.windowId,
          pinned: item.kind === 'tab' && item.tab.pinned === true,
          groupId: item.kind === 'group' ? item.group.groupId : undefined,
        });
      }
    }
    return { shown, incognito, tabs, items };
  }, [dragWindows, windows, collapsedIds]);

  // T1. The group, if any, holding the Tab Keeper page this pane is on. Open
  // now leaves that page out, so only Chrome can say; read again with each
  // snapshot, since the page can be grouped after the pane opened. Undefined
  // in the popup, which is no tab (getCurrent answers undefined). A ref, not
  // state: acceptsWindow reads it at the moment it is asked, and a re-render
  // would re-bind the engine's listeners for nothing.
  const pageGroupId = useRef<string | undefined>(undefined);
  useEffect(() => {
    let live = true;
    chrome.tabs.getCurrent().then(
      (tab) => {
        if (!live) return;
        pageGroupId.current =
          tab === undefined || tab.groupId === NO_GROUP
            ? undefined
            : String(tab.groupId);
      },
      // Unanswered, the last answer stands.
      () => undefined
    );
    return () => {
      live = false;
    };
  }, [windows]);

  // The latest callback, read at the moment a move settles, so a caller
  // passing a new function each render does not re-bind the engine.
  const onMovedRef = useRef(onMoved);
  useEffect(() => {
    onMovedRef.current = onMoved;
  }, [onMoved]);

  const accepts = useCallback(
    (held: Held | undefined, windowId: string): boolean => {
      // A row the snapshot does not hold describes no move either; nothing to
      // refuse here.
      if (held === undefined || windowId === held.windowId) return true;
      // K1: Chrome unpins a pinned tab moved to another window.
      if (held.pinned) return false;
      // O11d: incognito and normal refuse each other's rows.
      if (
        tables.incognito.get(windowId) !== tables.incognito.get(held.windowId)
      )
        return false;
      // T1: the group holding this page stays in its own window.
      if (held.groupId !== undefined && held.groupId === pageGroupId.current)
        return false;
      return true;
    },
    [tables]
  );

  const tabLandingRange = useCallback(
    (rowId: string, windowId: string | undefined): Range => {
      const shown =
        (windowId === undefined ? undefined : tables.shown.get(windowId)) ??
        NOTHING_SHOWN;
      return rangeIn(tables.tabs.get(rowId), windowId, shown, shown.tabs);
    },
    [tables]
  );
  const itemLandingRange = useCallback(
    (rowId: string, windowId: string | undefined): Range => {
      const shown =
        (windowId === undefined ? undefined : tables.shown.get(windowId)) ??
        NOTHING_SHOWN;
      return rangeIn(tables.items.get(rowId), windowId, shown, shown.items);
    },
    [tables]
  );
  const tabAcceptsWindow = useCallback(
    (rowId: string, windowId: string) =>
      accepts(tables.tabs.get(rowId), windowId),
    [accepts, tables]
  );
  const itemAcceptsWindow = useCallback(
    (rowId: string, windowId: string) =>
      accepts(tables.items.get(rowId), windowId),
    [accepts, tables]
  );

  // The drop, as Chrome calls. A drop the geometry describes no move for
  // (a row this snapshot does not hold, or a release that names no window)
  // calls nothing. Resolves with the record handed on, or null.
  const onTabMove = useCallback(
    async (
      rowId: string,
      toIndex: number,
      dropTargetId?: string,
      toWindowId?: string
    ): Promise<MovedTabs | null> => {
      const move = describeTabMove(rowId, toIndex, dropTargetId, toWindowId);
      if (move === undefined) return null;
      const moved = await moveOpenTab(move, windows, hasTabGroups);
      if (moved !== null) {
        keepForUndo({ kind: 'tab', moved });
        onMovedRef.current?.(moved);
      }
      return moved;
    },
    [describeTabMove, windows, hasTabGroups]
  );
  const onItemMove = useCallback(
    async (
      rowId: string,
      toIndex: number,
      // An items list declares no resolveDrop, so no band is ever named.
      _dropTargetId?: string,
      toWindowId?: string
    ): Promise<MovedTabs | null> => {
      const move = describeGroupMove(rowId, toIndex, toWindowId);
      if (move === undefined) return null;
      const moved = await moveOpenGroup(move, windows);
      if (moved !== null) {
        keepForUndo({ kind: 'group', moved });
        onMovedRef.current?.(moved);
      }
      return moved;
    },
    [describeGroupMove, windows]
  );

  return {
    tabs: {
      ...tabGeometry,
      landingRange: tabLandingRange,
      acceptsWindow: tabAcceptsWindow,
      onMove: onTabMove,
    },
    items: {
      ...itemGeometry,
      landingRange: itemLandingRange,
      acceptsWindow: itemAcceptsWindow,
      onMove: onItemMove,
    },
  };
}
