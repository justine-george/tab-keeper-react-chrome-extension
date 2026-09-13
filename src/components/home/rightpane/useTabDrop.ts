// The tab drag's rules, for a tab list spanning any number of saved windows
// (KAN-132).
//
// A tab drag used to be one drag area per window, and each window answered its
// own drop questions. A tab must now be able to name a row in ANOTHER window,
// which a per-window area cannot do, so the pane has one `tabs` area over the
// whole session and its questions are answered here, for every window at once.
// A window rendered on its own is the same list over one window.
//
// Everything below is still answered WITHIN ONE WINDOW -- the one the engine
// names as the landing window. Group positions are window-local indices, so a
// group in one window must never answer for a drop in another: an index is only
// valid in the list that produced it (KAN-131), and that lesson now applies one
// level up.
import { useCallback, useMemo } from 'react';
import { useDispatch } from 'react-redux';

import type { AppDispatch } from '../../../redux/store';
import {
  moveTabInternal,
  type tabData,
  type windowGroupData,
} from '../../../redux/slices/tabContainerDataStateSlice';
import {
  TAB_GROUP_COLOR_HEX,
  sanitizeTabGroupColor,
  partitionTabsIntoItems,
  type chromeTabGroupData,
} from '../../../utils/functions/tabGroups';
import type { LandingSide } from '../../../utils/functions/dragPreview';
import { bandAt, windowAt, type DropTarget } from './rowDrag/dropRules';

// Where one window's groups start and end in THAT window's tab list, and where
// each of its tabs sits. Window-local indices, the same ones moveTabInternal
// applies a drop index to.
interface WindowGroupEdges {
  indexOfTab: Map<string, number>;
  groupFirstIndex: Map<string, number>;
  groupLastIndex: Map<string, number>;
}

function groupEdgesOf(
  tabs: tabData[],
  groups: chromeTabGroupData[] | undefined
): WindowGroupEdges {
  const indexOfTab = new Map(tabs.map((tab, i) => [tab.tabId, i]));
  const groupFirstIndex = new Map<string, number>();
  const groupLastIndex = new Map<string, number>();
  for (const item of partitionTabsIntoItems(tabs, groups)) {
    if (item.kind !== 'group') continue;
    const first = item.tabs[0];
    const last = item.tabs[item.tabs.length - 1];
    const firstIndex = first ? indexOfTab.get(first.tabId) : undefined;
    const lastIndex = last ? indexOfTab.get(last.tabId) : undefined;
    if (firstIndex !== undefined)
      groupFirstIndex.set(item.group.groupId, firstIndex);
    if (lastIndex !== undefined)
      groupLastIndex.set(item.group.groupId, lastIndex);
  }
  return { indexOfTab, groupFirstIndex, groupLastIndex };
}

// Where a group's head sits in the space `toIndex` is counted in (KAN-170).
//
// TWO LISTS, AND THEY ARE NOT THE SAME ONE. `groupFirstIndex` counts every
// row; `toIndex` counts the rows with the HELD row lifted out, because it is
// the number of midpoints the pointer has passed. Lifting a row out shifts
// everything below it down one, so the two agree only when the held row sits
// BELOW the group.
//
// Comparing them directly made the head test over-reach by exactly one slot
// for any tab dragged down from above, which swallowed the group's second
// position into its first -- the slot drew above the first member while the
// drop landed below it. See KAN-131: an index is only valid in the list that
// produced it.
function headInLandingSpace(
  edges: WindowGroupEdges,
  groupId: string,
  rowId: string
): number | undefined {
  const first = edges.groupFirstIndex.get(groupId);
  if (first === undefined) return undefined;
  const fromIndex = edges.indexOfTab.get(rowId);
  return fromIndex !== undefined && fromIndex < first ? first - 1 : first;
}

// KAN-166. Which title row the dragged tab will land immediately beside, within
// one window.
//
// A tab released inside a group's band joins that group, and the band's rect
// includes the group's TITLE row -- while the landing index comes from row
// midpoints, the first of which sits below that title. So in the strip at the
// top of every group the index says "before the group" while the band says
// "inside it".
//
// Both answers are right, and neither is the whole answer: the tab becomes the
// group's FIRST member, which puts it under the title row. Naming the title row
// rather than an index is what lets the area work out the rest -- it is a
// different slot from the one the tab left even when its row index is
// unchanged, and which slot depends on the direction it arrived from.
//
// The DROP is untouched. This is the preview only; the reducer still receives
// the raw index and produces the same arrangement.
function landsBesideFixedRowIn(
  edges: WindowGroupEdges,
  rowId: string,
  toIndex: number,
  target: string | undefined
): { fixedRowId: string; side: LandingSide } | undefined {
  // Landing inside a band: the tab joins that group, or moves to the head of
  // the one it is already in. Either way it ends up UNDER that title row. At or
  // above the head is the strip where the index and the band disagree; below it
  // the tab is landing BETWEEN members, where its row index already says
  // everything.
  if (target !== undefined) {
    const head = headInLandingSpace(edges, target, rowId);
    if (head !== undefined && toIndex <= head) {
      return { fixedRowId: target, side: 'after' };
    }

    // KAN-176. The same question at the other end. Past the last member and
    // still inside the band, the tab is joining at the TAIL -- which is a slot
    // BEFORE the group's tail marker, not after it.
    //
    // The row index cannot say so, and this is KAN-174's ambiguity mirrored: it
    // names the row AFTER the group, which resolves to a slot PAST the marker,
    // so the marker never moves and the frame stops above the slot the tab will
    // occupy. Coming from above it happens to resolve to the same slot either
    // way, which is why only this direction was wrong.
    // NO LANDING-SPACE ADJUSTMENT HERE, unlike the head. Coming from above,
    // "before the tail marker" and "at the last member's slot" are the SAME
    // slot, so the branch firing or falling through to the row index gives an
    // identical answer -- an adjustment was written first and removed, because
    // a mutation proved it could never change one. Coming from below the row
    // index names the row PAST the marker, which is the case that needs this at
    // all.
    const tail = edges.groupLastIndex.get(target);
    return tail !== undefined && toIndex > tail
      ? { fixedRowId: `${target}:tail`, side: 'before' }
      : undefined;
  }

  // Landing outside every band: the tab ends up ungrouped. If that puts it at a
  // group's HEAD, it lands BEFORE that group's title row.
  //
  // NOT A QUESTION ABOUT WHERE THE TAB CAME FROM (KAN-174). This began as the
  // KAN-168 rule for a tab LEAVING the group it was already in, and that was
  // too narrow: a loose tab landing at the same head fell through to the row
  // index alone, which the area resolves to the slot that row OCCUPIES -- the
  // first member's. So the ghost pointed inside a band the tab was never going
  // to join, in the same place as an actual join, and the band's tint was the
  // only thing telling the two apart.
  //
  // The row index cannot answer it. "Land before row t" is ambiguous when a
  // title row sits immediately before t: before the title, or after it? It is
  // after only when the drop JOINS that group, which is the branch above.
  // Everything reaching here lands before.
  //
  // Matched EXACTLY rather than `<=`, unlike the joining branch. The whole strip
  // at the top of a band means "join at the head", but a landing index above a
  // group's head belongs to the rows above it, not to the group.
  //
  // THIS WINDOW'S GROUPS ONLY (KAN-132). Every window's groups start at a
  // window-local index, so window B's leading group sits at 0 just like window
  // A's first tab -- and asked across windows, a drag to the top of A would
  // answer "before B's title row".
  for (const groupId of edges.groupFirstIndex.keys()) {
    if (headInLandingSpace(edges, groupId, rowId) === toIndex) {
      return { fixedRowId: groupId, side: 'before' };
    }
  }
  return undefined;
}

// The windows a tab list spans, in render order, and the session they belong
// to. A whole session satisfies it; so does one window wrapped on its own.
export interface TabListWindows {
  tabGroupId: string;
  windows: readonly Pick<
    windowGroupData,
    'windowId' | 'tabs' | 'chromeTabGroups'
  >[];
}

/**
 * Everything a `tabs` drag area needs from the windows it lists.
 *
 * Tolerates no windows at all, because TabGroupDetailsContainer calls it above
 * its nothing-selected early return -- a hook below that return would change
 * the hook count between renders and React would throw on the transition.
 */
export function useTabDrop(
  tabList: TabListWindows | undefined,
  hasTabGroupsPermission: boolean
) {
  const dispatch: AppDispatch = useDispatch();
  const windows = tabList?.windows;
  const tabGroupId = tabList?.tabGroupId;

  // Every tab in the session, in render order. A tab drag must be able to name
  // a row in ANOTHER window, which a per-window area cannot do.
  const rowIds = useMemo(
    () => (windows ?? []).flatMap((w) => w.tabs.map((t) => t.tabId)),
    [windows]
  );

  // Which window each tab belongs to. The pane-wide area knows only row ids,
  // and which window owns a row is the list's own knowledge.
  const windowOfTab = useMemo(() => {
    const byId = new Map<string, string>();
    for (const w of windows ?? []) {
      for (const t of w.tabs) byId.set(t.tabId, w.windowId);
    }
    return byId;
  }, [windows]);

  // Per window, built from the same partition WindowEntryContainer renders --
  // including the permission gate, so the positions are those of the rows the
  // user actually sees.
  const edgesByWindow = useMemo(
    () =>
      new Map(
        (windows ?? []).map((w) => [
          w.windowId,
          groupEdgesOf(
            w.tabs,
            hasTabGroupsPermission ? w.chromeTabGroups : undefined
          ),
        ])
      ),
    [windows, hasTabGroupsPermission]
  );

  // KAN-164. Which group a tab release would put it in, answered in that
  // group's own colour.
  //
  // A tab released inside a group's band JOINS that group (dropRules.bandAt),
  // and until this the rule was invisible: measured mid-drag with the pointer
  // squarely inside a band, the band was byte-identical to its resting state.
  // The only way to learn what a release would do was to do it.
  //
  // The band publishes its colour as a custom property, which the wash and the
  // held tab's stripe both read -- so the feedback is the GROUP's identity
  // rather than an accent the app uses nowhere else.
  //
  // Every window's groups in one map: group ids are uuidv4 minted per capture,
  // so no two windows share one.
  const groupColorHex = useMemo(() => {
    const byId = new Map<string, string>();
    for (const w of windows ?? []) {
      for (const group of w.chromeTabGroups ?? []) {
        byId.set(
          group.groupId,
          TAB_GROUP_COLOR_HEX[sanitizeTabGroupColor(group.color)]
        );
      }
    }
    return byId;
  }, [windows]);

  // Written straight to the DOM rather than held in React state, because it
  // changes as the pointer moves and a re-render per move is the cost this drag
  // engine is built to avoid -- the same reason `data-drag-held` is set this way
  // (KAN-160). React never touches these, so a re-render cannot drop them.
  const onDropTargetChange = useCallback(
    (target: string | undefined, within: HTMLElement | null) => {
      if (!within) return;
      // Scoped to the element the area asked within -- the landing window's
      // block -- so a band in another window cannot light up alongside it.
      for (const band of within.querySelectorAll<HTMLElement>(
        '[data-band-id]'
      )) {
        if (target !== undefined && band.dataset.bandId === target) {
          band.setAttribute('data-drop-target', '');
          const colour = groupColorHex.get(target) ?? '';
          band.style.setProperty('--band-color', colour);
          document.documentElement.style.setProperty(
            '--drop-target-color',
            colour
          );
        } else {
          band.removeAttribute('data-drop-target');
        }
      }
      if (target === undefined) {
        document.documentElement.style.removeProperty('--drop-target-color');
      }
    },
    [groupColorHex]
  );

  // Composes the tab area's two drop questions into one answer (KAN-132).
  //
  // The area asks within the LANDING WINDOW's block, which until cross-window
  // drops are enabled is always the window the tab came from. `windowAt`
  // searches below the element it is given, and a window's marker is that
  // element itself, so it answers undefined for now; nothing reads it yet.
  const resolveDrop = useCallback(
    (within: HTMLElement | null, x: number, y: number): DropTarget => ({
      windowId: windowAt(within, x, y),
      bandId: bandAt(within, x, y),
    }),
    []
  );

  // `toIndex` is WINDOW-LOCAL: the area counts only the landing window's rows,
  // which is the index moveTabInternal applies to that window's stored tabs.
  const onMove = useCallback(
    (tabId: string, toIndex: number, toChromeGroupId?: string) => {
      const windowId = windowOfTab.get(tabId);
      if (tabGroupId === undefined || windowId === undefined) return;
      dispatch(
        moveTabInternal({
          tabGroupId,
          windowId,
          tabId,
          toIndex,
          toChromeGroupId,
        })
      );
    },
    [dispatch, tabGroupId, windowOfTab]
  );

  const landsBesideFixedRow = useCallback(
    (
      rowId: string,
      toIndex: number,
      target: string | undefined,
      windowId: string | undefined
    ) => {
      const edges =
        windowId === undefined ? undefined : edgesByWindow.get(windowId);
      return edges === undefined
        ? undefined
        : landsBesideFixedRowIn(edges, rowId, toIndex, target);
    },
    [edgesByWindow]
  );

  return {
    rowIds,
    onMove,
    resolveDrop,
    onDropTargetChange,
    landsBesideFixedRow,
  };
}
