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
// - Where a held row may land in a window (landingRange): a tab on any row,
//   the slot deciding its pin (KAN-814); a group below the pinned tabs (O11c).
// - Which windows take it at all (acceptsWindow): a row only windows of its
//   own profile (O11d), and a group holding the page this pane is on only its
//   own (T1, O11h). A pinned tab may leave its window (KAN-814 K-B).
// - A drop that changed something is a step in the undo history (O11f,
//   KAN-744 R1); a drop in place is not an action at all (ledger R23). One
//   that changed a tab's pin says so, with an Undo for that step (KAN-814).
// - A saved tab or group carried in (KAN-815) is adopted as a phantom in a
//   trailing New window block, and its release opens a copy in Chrome: no
//   move, no undo step, the saved session untouched.
//
// Both limits are asked on every pointer move, so each is a few map reads
// over tables built once per snapshot.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';

import { currentCarry, endCarry } from '../../../redux/carry';
import type { CarriedItem } from '../../../redux/carriedItem';
import { openCarriedCopy, type CopyPlace } from '../../../redux/openCopy';

import { showToast } from '../../../redux/slices/globalStateSlice';

import type { DragWindows } from '../rightpane/rowDrag/dropRules';
import { useGroupDropGeometry } from '../rightpane/useGroupDrop';
import { useTabDropGeometry } from '../rightpane/useTabDrop';
import type { OpenWindow } from '../../../utils/functions/openNow';
import {
  groupCopySlot,
  moveOpenGroup,
  moveOpenTab,
  tabCopySlot,
  type MovedTabs,
} from '../../../utils/functions/openNowMoves';
import type { AppDispatch } from '../../../redux/store';
import { keepLiveStep, whileMovingTabs } from '../../../redux/undoHistory';
import { TOAST_MESSAGES } from '../../../utils/constants/common';
import { noRowsTabIndex } from '../../../utils/functions/pinnedRun';
import {
  itemIdOf,
  partitionTabsIntoItems,
} from '../../../utils/functions/tabGroups';
import {
  OPEN_NOW_HEADER_NEW_WINDOW,
  OPEN_NOW_NEW_WINDOW,
} from './carriedIntoOpenNow';
import type { CarriedIntoOpenNow } from './carriedIntoOpenNow';

// Open now's two lists, named apart from the saved pane's `tabs` and `items`
// so a row can never join a list of the other pane.
export const OPEN_TABS_SCOPE = 'openTabs';
export const OPEN_ITEMS_SCOPE = 'openItems';
// KAN-280 Part F (D3 A). Windows, picked up only to be carried out.
export const OPEN_WINDOWS_SCOPE = 'openWindows';

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
// landingRange). A tab may land on any of them; a group only below the pinned
// run, the window's first `pinned` rows, as Chrome holds no pinned tab in one.
function rangeIn(
  held: Held | undefined,
  windowId: string | undefined,
  shown: Shown,
  rows: number
): Range {
  if (held === undefined || windowId === undefined) {
    return { min: 0, max: rows };
  }
  const others = held.windowId === windowId && rows > 0 ? rows - 1 : rows;
  return held.groupId === undefined
    ? { min: 0, max: others }
    : { min: shown.pinned, max: others };
}

interface Options {
  // The snapshot the pane draws. Its identity is what the tables below are
  // built from, so it must stay the same object while the windows do.
  windows: readonly OpenWindow[];
  hasTabGroups: boolean;
  // The windows the pane has folded shut, by Chrome id.
  collapsedIds: ReadonlySet<number>;
  // KAN-815. A saved tab or group carried in, or null. Memoized by the
  // caller, like `windows`: the tables are built from it.
  carriedIn: CarriedIntoOpenNow | null;
}

/**
 * Everything the Open now pane's two drag areas need: the `tabs` list (a tab
 * at a time) and the `items` list (a whole group by its title row).
 */
export function useOpenNowDrop({
  windows,
  hasTabGroups,
  collapsedIds,
  carriedIn,
}: Options) {
  const dispatch: AppDispatch = useDispatch();
  const { t } = useTranslation();
  // The trailing block comes last, as the pane draws it.
  const dragWindows = useMemo(
    () => [
      ...openDragWindows(windows, hasTabGroups),
      ...(carriedIn === null ? [] : [carriedIn.window]),
    ],
    [windows, hasTabGroups, carriedIn]
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
      const isCarriedIn = carriedIn?.window === window;
      if (open === undefined && !isCarriedIn) continue;
      incognito.set(
        window.windowId,
        open === undefined ? carriedIn?.incognito === true : open.incognito
      );
      const partition = partitionTabsIntoItems(
        window.tabs,
        window.chromeTabGroups
      );
      shown.set(
        window.windowId,
        open !== undefined && collapsedIds.has(open.id)
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
  }, [dragWindows, windows, collapsedIds, carriedIn]);

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

  const accepts = useCallback(
    (held: Held | undefined, windowId: string): boolean => {
      // A row the snapshot does not hold describes no move either; nothing to
      // refuse here.
      if (held === undefined || windowId === held.windowId) return true;
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

  // KAN-815. The saved item an adopted phantom stands for, when `rowId` is it.
  const carriedFor = useCallback(
    (rowId: string): CarriedItem | undefined => {
      const item = currentCarry()?.item;
      return carriedIn !== null &&
        rowId === carriedIn.rowId &&
        item?.source === 'saved'
        ? item
        : undefined;
    },
    [carriedIn]
  );

  // KAN-815. A copy is asked of Chrome, or nothing is; either way the carry
  // ends here, synchronously, as an adopted drop must end it (useTabDrop). A
  // live window of the other kind is refused here too, whatever the engine
  // checked (O11d, ledger R15). Resolves 'copied' once Chrome opened a copy at
  // the slot, so the rows hold until it is drawn (KAN-850); null for anything
  // else, a new window too, which is drawn below every row.
  const openCopy = useCallback(
    async (
      item: CarriedItem,
      toWindowId: string | undefined,
      place: (toWindowId: string) => CopyPlace | null
    ): Promise<'copied' | null> => {
      const at =
        toWindowId === undefined
          ? null
          : toWindowId === OPEN_NOW_NEW_WINDOW ||
              toWindowId === OPEN_NOW_HEADER_NEW_WINDOW
            ? { kind: 'newWindow' as const }
            : tables.incognito.get(toWindowId) !== carriedIn?.incognito
              ? null
              : place(toWindowId);
      const opened =
        at === null
          ? null
          : dispatch(openCarriedCopy(item, at, t('Go to URL')));
      endCarry(opened !== null ? 'copied' : 'cancelled');
      if (opened === null || at?.kind === 'newWindow') return null;
      return (await opened) ? 'copied' : null;
    },
    [tables, carriedIn, dispatch, t]
  );

  // The drop, as Chrome calls. A drop the geometry describes no move for
  // (a row this snapshot does not hold, or a release that names no window)
  // calls nothing. Resolves with each moved tab's place before and after,
  // 'copied' for a saved item's copy opened at the slot, or null when nothing
  // moved.
  const onTabMove = useCallback(
    async (
      rowId: string,
      toIndex: number,
      dropTargetId?: string,
      toWindowId?: string
    ): Promise<MovedTabs | 'copied' | null> => {
      // A folded window shows no slot, so the engine's position 0 chose no
      // pin there: the tab keeps its own, as in a saved session.
      const folded = windows.find(
        (w) => String(w.id) === toWindowId && collapsedIds.has(w.id)
      );
      const carried = carriedFor(rowId);
      if (carried !== undefined) {
        const savedPinned = carriedIn?.pinned === true;
        return openCopy(carried, toWindowId, (liveId) => {
          const slot = tabCopySlot(
            windows,
            liveId,
            folded === undefined
              ? toIndex
              : noRowsTabIndex(folded.tabs, savedPinned),
            savedPinned,
            dropTargetId,
            hasTabGroups
          );
          return slot === null ? null : { kind: 'tab', slot };
        });
      }
      const index =
        folded === undefined
          ? toIndex
          : noRowsTabIndex(
              folded.tabs,
              tables.tabs.get(rowId)?.pinned === true
            );
      const move = describeTabMove(rowId, index, dropTargetId, toWindowId);
      if (move === undefined) return null;
      const moved = await whileMovingTabs(() =>
        moveOpenTab(move, windows, hasTabGroups)
      );
      if (moved === null) return null;
      const id = keepLiveStep(dispatch, { kind: 'tab', moved });
      const pinChange = moved.find(
        ({ before, after }) => before.pinned !== after.pinned
      );
      if (id !== null && pinChange !== undefined) {
        await dispatch(
          showToast({
            toastText: pinChange.after.pinned
              ? TOAST_MESSAGES.TAB_PINNED
              : TOAST_MESSAGES.TAB_UNPINNED,
            liveStepId: id,
          })
        );
      }
      return moved;
    },
    [
      describeTabMove,
      windows,
      collapsedIds,
      tables,
      hasTabGroups,
      dispatch,
      carriedFor,
      carriedIn,
      openCopy,
    ]
  );
  const onItemMove = useCallback(
    async (
      rowId: string,
      toIndex: number,
      // An items list declares no resolveDrop, so no band is ever named.
      _dropTargetId?: string,
      toWindowId?: string
    ): Promise<MovedTabs | 'copied' | null> => {
      const carried = carriedFor(rowId);
      if (carried !== undefined) {
        return openCopy(carried, toWindowId, (liveId) => {
          const slot = groupCopySlot(windows, liveId, toIndex);
          return slot === null ? null : { kind: 'group', slot };
        });
      }
      const move = describeGroupMove(rowId, toIndex, toWindowId);
      if (move === undefined) return null;
      const moved = await whileMovingTabs(() => moveOpenGroup(move, windows));
      if (moved !== null) {
        keepLiveStep(dispatch, { kind: 'group', moved });
      }
      return moved;
    },
    [describeGroupMove, windows, dispatch, carriedFor, openCopy]
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
