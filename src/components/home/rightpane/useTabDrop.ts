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
  moveTabAcrossWindowsInternal,
  moveTabInternal,
  type tabData,
} from '../../../redux/slices/tabContainerDataStateSlice';
import {
  TAB_GROUP_COLOR_HEX,
  sanitizeTabGroupColor,
  partitionTabsIntoItems,
  type chromeTabGroupData,
} from '../../../utils/functions/tabGroups';
import {
  bandAt,
  groupEndingAbove,
  type BandGapChange,
  type DropTarget,
  type FixedRowLanding,
  type PaneWindows,
  type RemovedFixedRows,
} from './rowDrag/dropRules';
import { ADJACENT_GROUP_GAP_PX, BAND_MARGIN_PX } from './bandSpacing';

// Where one window's groups start and end in THAT window's tab list, and where
// each of its tabs sits. Window-local indices, the same ones moveTabInternal
// applies a drop index to.
interface WindowGroupEdges {
  indexOfTab: Map<string, number>;
  groupFirstIndex: Map<string, number>;
  groupLastIndex: Map<string, number>;
  // KAN-169. Which band each tab is drawn in, how many tabs answer to each
  // group over the WHOLE window -- moveTabInternal prunes on `some`, so a group
  // split across two runs still has a member left -- and what each band's
  // neighbours are, which decides the gap they keep once the band is gone.
  groupOfTab: Map<string, string>;
  groupSize: Map<string, number>;
  bandNeighbours: Map<string, BandNeighbours>;
  // KAN-187. For a LOOSE tab that is the only thing between two bands, the
  // band BELOW it -- the one whose top gap widens when that tab leaves.
  bandBelowLooseTabInGap: Map<string, string>;
}

type ItemKind = 'tab' | 'group';
interface BandNeighbours {
  above: ItemKind | undefined;
  below: ItemKind | undefined;
  // WHICH band sits above, when one does (KAN-187). The kind alone cannot say
  // whether that band is the one a drop is about to prune.
  aboveBandId: string | undefined;
}

export function groupEdgesOf(
  tabs: tabData[],
  groups: chromeTabGroupData[] | undefined
): WindowGroupEdges {
  const indexOfTab = new Map(tabs.map((tab, i) => [tab.tabId, i]));
  const groupFirstIndex = new Map<string, number>();
  const groupLastIndex = new Map<string, number>();
  const groupOfTab = new Map<string, string>();
  const groupSize = new Map<string, number>();
  const bandNeighbours = new Map<string, BandNeighbours>();
  const bandBelowLooseTabInGap = new Map<string, string>();
  const items = partitionTabsIntoItems(tabs, groups);
  items.forEach((item, i) => {
    if (item.kind !== 'group') return;
    const first = item.tabs[0];
    const last = item.tabs[item.tabs.length - 1];
    const firstIndex = first ? indexOfTab.get(first.tabId) : undefined;
    const lastIndex = last ? indexOfTab.get(last.tabId) : undefined;
    if (firstIndex !== undefined)
      groupFirstIndex.set(item.group.groupId, firstIndex);
    if (lastIndex !== undefined)
      groupLastIndex.set(item.group.groupId, lastIndex);
    for (const tab of item.tabs) {
      groupOfTab.set(tab.tabId, item.group.groupId);
      groupSize.set(
        item.group.groupId,
        (groupSize.get(item.group.groupId) ?? 0) + 1
      );
    }
    const previous = items[i - 1];
    bandNeighbours.set(item.group.groupId, {
      above: previous?.kind,
      below: items[i + 1]?.kind,
      aboveBandId:
        previous?.kind === 'group' ? previous.group.groupId : undefined,
    });
  });
  items.forEach((item, i) => {
    if (item.kind !== 'tab') return;
    const below = items[i + 1];
    if (items[i - 1]?.kind === 'group' && below?.kind === 'group') {
      bandBelowLooseTabInGap.set(item.tab.tabId, below.group.groupId);
    }
  });
  return {
    indexOfTab,
    groupFirstIndex,
    groupLastIndex,
    groupOfTab,
    groupSize,
    bandNeighbours,
    bandBelowLooseTabInGap,
  };
}

// KAN-187. How much LESS room a loose row needs between two bands than its own
// footprint: the pair stops sharing KAN-179's wide gap and each keeps its own
// margin instead. Measured +/-4 in every direction on main.
const GAP_RELIEF_PX = ADJACENT_GROUP_GAP_PX - 2 * BAND_MARGIN_PX;

/**
 * The band whose top gap CLOSES because the held row is leaving the space
 * between it and the band above (KAN-187), or undefined.
 *
 * About the ORIGIN alone: it fires wherever the row lands, and whether or not
 * it joins something on arrival -- measured, a row that leaves this gap to
 * join the band below still leaves the pair adjacent behind it.
 *
 * A GROUPED row leaving is not this: its band may be pruned instead, and that
 * path (KAN-169) already states what gap its neighbours keep.
 */
export function gapClosedByLeavingIn(
  edges: WindowGroupEdges,
  rowId: string
): BandGapChange | undefined {
  const bandId = edges.bandBelowLooseTabInGap.get(rowId);
  return bandId === undefined ? undefined : { bandId, delta: GAP_RELIEF_PX };
}

/**
 * The band whose top gap OPENS because the held row is landing loose between
 * it and the band above (KAN-187), or undefined.
 *
 * ASKED OF THE LIST WITH THE HELD ROW LIFTED OUT, which is the whole subtlety.
 * `bandNeighbours` describes the list as DRAWN, and a row dropped back into
 * the gap it already occupies would read as "the band above is a tab" and
 * answer nothing -- while the drop genuinely re-opens the gap it is closing by
 * leaving. So a band whose only separation from the band above IS the held row
 * counts as adjacent here, and the two sides then cancel, which is the correct
 * preview for putting a row back where it was.
 *
 * A drop that JOINS a band lands inside it, not in the gap above it.
 */
export function gapOpenedByLandingIn(
  edges: WindowGroupEdges,
  rowId: string,
  toIndex: number,
  target: string | undefined,
  removedBandId?: string
): BandGapChange | undefined {
  if (target !== undefined) return undefined;
  for (const groupId of edges.groupFirstIndex.keys()) {
    const neighbours = edges.bandNeighbours.get(groupId);
    // WHERE THIS DROP PRUNES A BAND, KAN-169 OWNS THE GAP ARITHMETIC. It
    // already states what the survivors keep once that band is gone --
    // including the 2px-each-side case where the held row lands loose in its
    // place -- so claiming the same 4px here took it off twice. Measured: the
    // lower band previewed at 162 against a truth of 166.
    //
    // TWO bands have to stand aside, because a row landing where its own band
    // stood satisfies both heads at once: the pruned band ITSELF, which will
    // not exist to have a gap above it, and the band BELOW it, whose gap above
    // is the one KAN-169 is already accounting for.
    const prunedItself = groupId === removedBandId;
    const prunedAbove =
      removedBandId !== undefined && neighbours?.aboveBandId === removedBandId;
    if (prunedItself || prunedAbove) continue;
    const adjacentOnce = neighbours?.above === 'group';
    const separatedOnlyByTheHeldRow =
      edges.bandBelowLooseTabInGap.get(rowId) === groupId;
    if (!adjacentOnce && !separatedOnlyByTheHeldRow) continue;
    if (headInLandingSpace(edges, groupId, rowId) === toIndex) {
      return { bandId: groupId, delta: -GAP_RELIEF_PX };
    }
  }
  return undefined;
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
export function landsBesideFixedRowIn(
  edges: WindowGroupEdges,
  rowId: string,
  toIndex: number,
  target: string | undefined
): FixedRowLanding | undefined {
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
      return {
        fixedRowId: groupId,
        side: 'before',
        offset: looseBeforeHeadOffset(edges, groupId, rowId),
      };
    }
  }

  // KAN-181. The same question at the other end: an ungrouped landing
  // immediately PAST a group's last member. Left unnamed it resolves to the
  // slot a tail JOIN resolves to, so the group's tail marker never moves while
  // its members do, and the colour strip hangs a row below the group -- over
  // the slot this tab is about to take, reading as a join.
  //
  // AFTER the head loop, deliberately. Between two adjacent groups both
  // questions are true at once, and the head answer is the one KAN-178 and
  // KAN-179 were measured against; this fires where the group is followed by a
  // loose tab or by nothing at all.
  //
  // THIS WINDOW'S GROUPS ONLY, for the reason the head loop gives above.
  const fromIndex = edges.indexOfTab.get(rowId);
  const ending = groupEndingAbove(edges.groupLastIndex, fromIndex, toIndex);
  if (ending === undefined) return undefined;
  // KAN-167. From above -- or leaving that group downward -- the slot resolves
  // to the last member's old top (KAN-178), and a loose tab settles that
  // band's bottom margin below it. From below the slot is the row after the
  // band, which already pays that margin.
  const lastIndex = edges.groupLastIndex.get(ending);
  const fromAbove =
    fromIndex !== undefined &&
    lastIndex !== undefined &&
    fromIndex <= lastIndex;
  return {
    fixedRowId: `${ending}:tail`,
    side: 'after',
    ...(fromAbove ? { offset: BAND_MARGIN_PX } : {}),
  };
}

// KAN-167. Where a tab landing LOOSE before a group's title row settles,
// relative to the slot that answer resolves to -- or undefined where the slot
// is already exact.
//
// FROM BELOW (a member leaving upward included: it resolves the same way) the
// slot is the title row's own top. That top sits the band's top margin below
// whatever is above it, and a loose tab keeps only the gap a loose tab keeps
// there: nothing over another loose tab or at the top of the window, a band
// margin over another band. Measured: 98 promised, 96 rested; between two
// bands 138 promised, 132 rested -- the wider KAN-179 gap less a band margin.
//
// FROM ABOVE the slot is the row before the title row, which that row vacates
// -- exact over a loose row. Over another band it is that band's last member,
// and the loose tab settles that band's bottom margin below it: 98 promised,
// 100 rested.
function looseBeforeHeadOffset(
  edges: WindowGroupEdges,
  groupId: string,
  rowId: string
): number | undefined {
  const first = edges.groupFirstIndex.get(groupId);
  const fromIndex = edges.indexOfTab.get(rowId);
  const above = edges.bandNeighbours.get(groupId)?.above;
  const fromAbove =
    first !== undefined && fromIndex !== undefined && fromIndex < first;
  if (fromAbove) return above === 'group' ? BAND_MARGIN_PX : undefined;
  return above === 'group'
    ? -(ADJACENT_GROUP_GAP_PX - BAND_MARGIN_PX)
    : -BAND_MARGIN_PX;
}

// KAN-169. Whether this drop EMPTIES the dragged tab's group -- and so removes
// its band -- and what gap the band's neighbours keep once it is gone.
//
// The same test moveTabInternal applies when it prunes: after the tab is back
// in the array with its new membership, does anything still answer to the old
// group? Here that is "the tab is its group's only member, and it is not
// landing back in that group" -- and landing in another window leaves the
// group whatever band the pointer is over there.
//
// The gap is the list's own spacing, which the engine cannot measure because
// the layout it belongs to does not exist yet. Loose tabs sit flush; a band
// keeps BAND_MARGIN_PX from whatever is beside it; and a band directly below
// another band widens that to ADJACENT_GROUP_GAP_PX (KAN-179). So once this
// band is gone, its two neighbours keep whichever of those applies to THEM --
// unless the tab is landing loose in the very place its band stood, in which
// case the tab itself is now each neighbour's neighbour, and two groups either
// side keep a band margin EACH rather than the adjacent-group gap. Measured:
// 44px closed up there against 40 with the tab landing elsewhere.
export function fixedRowsRemovedByIn(
  edges: WindowGroupEdges,
  rowId: string,
  toIndex: number,
  target: string | undefined,
  leavesWindow: boolean
): RemovedFixedRows | undefined {
  const groupId = edges.groupOfTab.get(rowId);
  if (groupId === undefined) return undefined;
  if (edges.groupSize.get(groupId) !== 1) return undefined;
  if (!leavesWindow && target === groupId) return undefined;

  const { above, below } = edges.bandNeighbours.get(groupId) ?? {
    above: undefined,
    below: undefined,
  };
  const landsLooseInPlace =
    !leavesWindow &&
    target === undefined &&
    toIndex === edges.indexOfTab.get(rowId);
  const gapKept = landsLooseInPlace
    ? (above === 'group' ? BAND_MARGIN_PX : 0) +
      (below === 'group' ? BAND_MARGIN_PX : 0)
    : above === 'group' && below === 'group'
      ? ADJACENT_GROUP_GAP_PX
      : above === 'group' || below === 'group'
        ? BAND_MARGIN_PX
        : 0;

  return { first: groupId, last: `${groupId}:tail`, gapKept };
}

/**
 * Everything a `tabs` drag area needs from the windows it lists. Read by
 * TabDragArea, the one place a tab list is wired up.
 */
export function useTabDrop(
  tabList: PaneWindows,
  hasTabGroupsPermission: boolean
) {
  const dispatch: AppDispatch = useDispatch();
  const { windows, tabGroupId } = tabList;

  // Every tab in the session, in render order. A tab drag must be able to name
  // a row in ANOTHER window, which a per-window area cannot do.
  const rowIds = useMemo(
    () => windows.flatMap((w) => w.tabs.map((t) => t.tabId)),
    [windows]
  );

  // Which window each tab belongs to. The pane-wide area knows only row ids,
  // and which window owns a row is the list's own knowledge.
  const windowOfTab = useMemo(() => {
    const byId = new Map<string, string>();
    for (const w of windows) {
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
        windows.map((w) => [
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
    for (const w of windows) {
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
    (target: string | undefined, list: HTMLElement | null) => {
      if (!list) return;
      // Every band in the list, not only the target's window: the band the
      // pointer has just left may sit in another window, and must be cleared
      // (KAN-132). Group ids are unique across windows, so only the target is
      // marked.
      for (const band of list.querySelectorAll<HTMLElement>('[data-band-id]')) {
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

  // Answers the tab area's one drop question: which band, if any, the pointer
  // is over (KAN-132). The area asks within the LANDING WINDOW's block, which
  // it names itself from its own hit test and hands to onMove directly --
  // resolveDrop is never asked which window, only which band.
  const resolveDrop = useCallback(
    (within: HTMLElement | null, x: number, y: number): DropTarget => ({
      bandId: bandAt(within, x, y),
    }),
    []
  );

  // `toIndex` is WINDOW-LOCAL: the area counts only the rows of `toWindowId`,
  // the window the release landed in, which is the index the reducer applies
  // to that window's stored tabs.
  //
  // Two reducers, not one widened one (spec 7): moveTabInternal's no-op guard
  // and its prune ordering both rest on the tab never leaving the array it was
  // spliced from. A drop that names no window has nowhere to go.
  const onMove = useCallback(
    (
      tabId: string,
      toIndex: number,
      toChromeGroupId?: string,
      toWindowId?: string
    ) => {
      const fromWindowId = windowOfTab.get(tabId);
      if (fromWindowId === undefined || toWindowId === undefined) return;
      dispatch(
        fromWindowId === toWindowId
          ? moveTabInternal({
              tabGroupId,
              windowId: fromWindowId,
              tabId,
              toIndex,
              toChromeGroupId,
            })
          : moveTabAcrossWindowsInternal({
              tabGroupId,
              fromWindowId,
              toWindowId,
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

  // KAN-169. Answered in the tab's OWN window, whatever window it lands in: the
  // group that empties is the one it came from.
  const fixedRowsRemovedBy = useCallback(
    (
      rowId: string,
      toIndex: number,
      target: string | undefined,
      windowId: string | undefined
    ) => {
      const ownWindowId = windowOfTab.get(rowId);
      const edges =
        ownWindowId === undefined ? undefined : edgesByWindow.get(ownWindowId);
      return edges === undefined
        ? undefined
        : fixedRowsRemovedByIn(
            edges,
            rowId,
            toIndex,
            target,
            windowId !== ownWindowId
          );
    },
    [edgesByWindow, windowOfTab]
  );

  // KAN-187. Both sides of one release: the gap the row VACATES is its own
  // window's business, the gap it OPENS belongs to the window it lands in, and
  // in a cross-window drag those are different windows.
  const gapChangesBy = useCallback(
    (
      rowId: string,
      toIndex: number,
      target: string | undefined,
      windowId: string | undefined
    ) => {
      const ownWindowId = windowOfTab.get(rowId);
      const source =
        ownWindowId === undefined ? undefined : edgesByWindow.get(ownWindowId);
      const destination =
        windowId === undefined ? undefined : edgesByWindow.get(windowId);
      const changes: BandGapChange[] = [];
      const closed =
        source === undefined ? undefined : gapClosedByLeavingIn(source, rowId);
      if (closed !== undefined) changes.push(closed);
      // The band this same release prunes, if any -- KAN-169 owns the gap
      // arithmetic wherever that happens, and the two must not both claim it.
      const pruned =
        source === undefined
          ? undefined
          : fixedRowsRemovedByIn(
              source,
              rowId,
              toIndex,
              target,
              windowId !== ownWindowId
            );
      const opened =
        destination === undefined
          ? undefined
          : gapOpenedByLandingIn(
              destination,
              rowId,
              toIndex,
              target,
              pruned?.first
            );
      if (opened !== undefined) changes.push(opened);
      return changes;
    },
    [edgesByWindow, windowOfTab]
  );

  return {
    rowIds,
    onMove,
    resolveDrop,
    onDropTargetChange,
    landsBesideFixedRow,
    fixedRowsRemovedBy,
    gapChangesBy,
  };
}
