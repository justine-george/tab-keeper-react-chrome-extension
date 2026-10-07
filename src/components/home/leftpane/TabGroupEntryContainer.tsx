import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Divider from '../../common/Divider';
import TabGroupEntry from './TabGroupEntry';
import EmptySavedList from './EmptySavedList';
import { SPRING_OPEN_MS } from '../../common/springOpen';
import {
  SAVED_SEARCH_GLASS_INSET,
  SAVED_SEARCH_TEXT_PADDING,
} from './savedListInset';
import SearchRow from '../../common/SearchRow';
import NoMatchState from '../../common/NoMatchState';
import { useNoMatchPlace } from '../../../hooks/useNoMatchPlace';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { AppDispatch, RootState } from '../../../redux/store';
import { filterTabGroups } from '../../../utils/functions/local';
import { setSearchInputText } from '../../../redux/slices/globalStateSlice';
import { useSavedSearch } from '../../../hooks/useSavedSearch';
import { useIsSavedListEmpty } from '../../../hooks/useIsSavedListEmpty';
import {
  deleteTabContainer,
  openAllTabContainer,
  requestFocusTabContainer,
  selectTabContainer,
  tabContainerData,
} from '../../../redux/slices/tabContainerDataStateSlice';
import { useTranslation } from 'react-i18next';
import { RowDragArea, DraggableRow } from '../rightpane/rowDrag/RowDragArea';
import { edgeScrollStep } from '../rightpane/rowDrag/edgeScroll';
import { dropOnTop } from '../../../redux/dropOnTop';
import { sessionDrop } from '../../../redux/dropSpecs';
import { showSession } from '../../../redux/showSession';
import { dropOnSessionRow } from '../../../redux/dropOnSessionRow';
import {
  carryEndedAs,
  currentCarry,
  registerCarryReceiver,
  subscribeCarry,
  type CarryReceiver,
} from '../../../redux/carry';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { useSearchShortcut } from '../../../hooks/useSearchShortcut';
import { dropBoxStyle } from '../../common/dropBoxStyle';
import { DURATION } from '../../../styles/scale';
import {
  newSessionPitch,
  settleNewSessionSlot,
  translateYOf,
  useNewSessionSlot,
} from './newSessionSlot';

export default function TabGroupEntryContainer() {
  const COLORS = useThemeColors();
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();

  // The scrolling element, so KAN-143's effect scopes its lookup to this list
  // rather than searching the whole document.
  const listRef = useRef<HTMLDivElement>(null);
  // The rows' column, which slides down to open the New session place.
  const columnRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const focusSearchField = () => {
    const input = searchInputRef.current;
    if (input === null) return;
    input.focus();
    input.select();
  };
  useSearchShortcut('saved', focusSearchField);

  const tabContainerDataList = useSelector(
    (state: RootState) => state.tabContainerDataState
  );

  const { text: searchText, term: searchTerm, isSearching } = useSavedSearch();
  const { query: noMatchQuery, place: noMatchPlace } = useNoMatchPlace();
  const isEmpty = useIsSavedListEmpty();

  const hasTabGroupsPermission = useSelector(
    (state: RootState) => state.globalState.hasTabGroupsPermission
  );

  const selectedTabGroupId = tabContainerDataList.selectedTabGroupId;

  // KAN-131, at the session level and more exposed than the panes below it:
  // search filters sessions directly, so an index counted over the rendered
  // list would be applied to a longer stored one.

  const handleMoveSession = useCallback(
    (tabGroupId: string, toIndex: number) => {
      dispatch(dropOnTop(sessionDrop(tabGroupId, toIndex)));
    },
    [dispatch]
  );

  // filter the tab group list
  let filteredTabGroups: tabContainerData[] = tabContainerDataList.tabGroups;
  if (searchTerm !== null) {
    filteredTabGroups = filterTabGroups(
      searchTerm,
      filteredTabGroups,
      hasTabGroupsPermission
    );
  }

  // In render order, which is what a drop's index counts against.
  const sessionIds = useMemo(
    () => filteredTabGroups.map((g) => g.tabGroupId),
    [filteredTabGroups]
  );

  const filteredIds = filteredTabGroups.map((g) => g.tabGroupId).join('\u0000');

  // While searching, keep a match selected; clearing leaves that match selected.
  useEffect(() => {
    if (!isSearching) return;
    if (filteredTabGroups.length === 0) return;
    if (filteredTabGroups.some((g) => g.tabGroupId === selectedTabGroupId)) {
      return;
    }
    dispatch(selectTabContainer(filteredTabGroups[0].tabGroupId));
  }, [searchTerm, selectedTabGroupId, filteredIds]);

  // KAN-143. Follow the selected session when the list rearranges under it.
  //
  // Editing a session moves it to the top (KAN-141), and the edit is made in
  // the RIGHT pane -- a rename, adding a tab -- so the user is not watching the
  // left pane when it happens. Select a session, scroll the list to look at
  // others, edit it, and the row simply vanishes with nothing to say where it
  // went.
  //
  // IT ONLY REPRODUCES WHILE THE ROW IS OFF SCREEN, and that is worth knowing
  // before you test this. When the row is visible, Chrome's scroll anchoring
  // has already picked it as the anchor and follows it to its new position by
  // itself -- measured, with no script writing scrollTop at all -- so both a
  // fixed and an unfixed build keep it in view and this effect looks like a
  // no-op. Off screen it anchors nothing: measured on an unfixed build, a row
  // 201px above the fold moved to the top and the pane did not budge, leaving
  // it 886px away.
  //
  // KEYED ON WHERE THE SELECTED ROW IS, not on every render. That is what keeps
  // it from fighting the user: scrolling the list by hand changes neither the
  // index nor the id, so a hand-scrolled list is never yanked back. It re-runs
  // on the id too, because the same index can hold a different session -- and
  // that costs nothing, since a row the user just clicked is on screen already.
  //
  // `block: 'nearest'` is what makes that true: it scrolls the minimum needed
  // and does nothing at all when the row is already visible, which is the
  // common case for every re-run except the one this exists for. It is also
  // what keeps this from second-guessing the browser -- in the visible case
  // above, where anchoring has already done the right thing, 'nearest' has
  // nothing left to do.
  //
  // -1 when nothing is selected, which only an empty list produces.
  // It is a trigger and nothing else -- the lookup below goes by id, so this is
  // read only as a dependency.
  const selectedIndex =
    selectedTabGroupId === null ? -1 : sessionIds.indexOf(selectedTabGroupId);
  useEffect(() => {
    if (selectedTabGroupId === null) return;
    // Missing whenever the selection is not on screen -- filtered out by a
    // search, or already gone. There is nothing to scroll to, and skipping is
    // the whole handling. An index guard here would be dead code: it can only
    // be out of range in the cases this lookup already misses (verified by
    // mutation -- removing it failed nothing).
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-drag-row-id="${CSS.escape(selectedTabGroupId)}"]`
    );
    row?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, selectedTabGroupId]);

  // KAN-350. The list takes a carry: the row under the pointer is the target
  // (D2 A); resting on it opens that session (S1 A); letting go on it moves
  // the carried item into that session as a new first window (S2 A).
  //
  // The target is held twice: in a ref, which take() reads on the release in
  // the same event that aimed it, and in state, which draws it.
  const [carryTargetId, setCarryTargetId] = useState<string | null>(null);
  const carryTargetRef = useRef<string | null>(null);

  // Not a receiver while searching (KAN-385); a search started mid-carry ends it (CarryLayer).
  useEffect(() => {
    if (isSearching) return;

    const aim = (id: string | null) => {
      if (carryTargetRef.current === id) return;
      carryTargetRef.current = id;
      setCarryTargetId(id);
    };

    // Measured when a carry enters the scroller, and again on its next entry.
    // The rows are kept in CONTENT space -- from the top of the scrolled
    // content, not the viewport -- so the list can scroll under a resting
    // pointer and the hit still names the row that is under it.
    let entry: {
      box: DOMRect;
      rows: { id: string; top: number; bottom: number }[];
    } | null = null;
    let lastY = 0;
    let frame = 0;

    const measure = (el: HTMLElement) => {
      const box = el.getBoundingClientRect();
      // At rest: entered from the New session target, the column may still be sliding back.
      const shift =
        columnRef.current === null ? 0 : translateYOf(columnRef.current);
      const rows = [
        ...el.querySelectorAll<HTMLElement>('[data-drag-row-id]'),
      ].flatMap((row) => {
        const id = row.dataset.dragRowId;
        if (id === undefined) return [];
        const r = row.getBoundingClientRect();
        return [
          {
            id,
            top: r.top - shift - box.top + el.scrollTop,
            bottom: r.bottom - shift - box.top + el.scrollTop,
          },
        ];
      });
      return { box, rows };
    };

    const retarget = () => {
      const el = listRef.current;
      if (el === null || entry === null) return;
      const y = lastY - entry.box.top + el.scrollTop;
      aim(entry.rows.find((r) => y >= r.top && y < r.bottom)?.id ?? null);
    };

    // Near the scroller's top or bottom edge the list travels, as it does
    // under an engine drag (KAN-152), and the target is re-read after every
    // step. Stops when the pointer leaves the edge zone or the list cannot go
    // further; the next move starts it again.
    const tick = () => {
      frame = 0;
      const el = listRef.current;
      if (el === null || entry === null) return;
      const delta = edgeScrollStep(entry.box, lastY);
      if (delta === 0) return;
      const before = el.scrollTop;
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTop = Math.max(0, Math.min(max, before + delta));
      if (el.scrollTop === before) return;
      retarget();
      frame = requestAnimationFrame(tick);
    };

    // The scroller's box, read now, and whether a point is in it.
    const measureHit = (): ((x: number, y: number) => boolean) => {
      const el = listRef.current;
      if (el === null) return () => false;
      const b = el.getBoundingClientRect();
      return (x, y) => x >= b.left && x < b.right && y >= b.top && y < b.bottom;
    };

    const receiver: CarryReceiver = {
      hit: (x, y) => measureHit()(x, y),
      measureHit,
      hover(_x, y) {
        const el = listRef.current;
        if (el === null) return;
        entry ??= measure(el);
        lastY = y;
        retarget();
        if (frame === 0 && edgeScrollStep(entry.box, y) !== 0) {
          frame = requestAnimationFrame(tick);
        }
      },
      leave() {
        entry = null;
        if (frame !== 0) cancelAnimationFrame(frame);
        frame = 0;
        aim(null);
      },
      // Commits synchronously and says whether anything moved; the layer
      // ends the carry after this either way.
      take() {
        const id = carryTargetRef.current;
        const carry = currentCarry();
        if (id === null || carry === null) return false;
        return dispatch(dropOnSessionRow(carry.carried, id));
      },
    };

    const unregister = registerCarryReceiver(receiver);
    return () => {
      unregister();
      receiver.leave();
    };
  }, [isSearching, dispatch]);

  // KAN-406. A cancelled carry puts the list back at its scroll when the
  // carry started, on the frame after, past KAN-143's follow above.
  useEffect(() => {
    let last = currentCarry()?.carried ?? null;
    let scrollAtStart = listRef.current?.scrollTop ?? 0;
    return subscribeCarry(() => {
      const now = currentCarry()?.carried ?? null;
      if (now === last) return;
      const ended = last;
      last = now;
      if (now !== null) {
        scrollAtStart = listRef.current?.scrollTop ?? 0;
      } else if (ended !== null && carryEndedAs(ended) === 'cancelled') {
        const top = scrollAtStart;
        requestAnimationFrame(() => {
          if (listRef.current !== null) listRef.current.scrollTop = top;
        });
      }
    });
  }, []);

  // S1 A. Resting on a row opens its session after SPRING_OPEN_MS. Started
  // by the same change that puts data-carry-target on the row -- this effect
  // runs on the commit that drew it -- so the sweep and the timer begin
  // together, and a new target restarts both. The session on screen already
  // has no timer (Q3 A); after a spring-open the row the pointer rests on is
  // that session, so its timer stops there.
  const dwellId =
    carryTargetId !== null && carryTargetId !== selectedTabGroupId
      ? carryTargetId
      : null;
  useEffect(() => {
    if (dwellId === null) return;
    const timer = setTimeout(
      () => dispatch(showSession(dwellId)),
      SPRING_OPEN_MS
    );
    return () => clearTimeout(timer);
  }, [dwellId, dispatch]);

  // KAN-394 N1. The place a release on the New session target fills, a row and its divider tall.
  const newSessionSlot = useNewSessionSlot();
  useLayoutEffect(() => {
    const column = columnRef.current;
    if (newSessionSlot !== 'open' || column === null) return;
    // Picked A: at once, so the place and the release land in view; the list receiver re-measures on entry.
    const list = listRef.current;
    if (list !== null && list.scrollTop > 0) list.scrollTop = 0;
    column.style.setProperty(
      '--new-session-pitch',
      `${newSessionPitch(column)}px`
    );
  }, [newSessionSlot]);
  // Two frames, so the fill is painted first; never cancelled, so it cannot stay filled.
  useEffect(() => {
    if (newSessionSlot !== 'filled') return;
    requestAnimationFrame(() => requestAnimationFrame(settleNewSessionSlot));
  }, [newSessionSlot]);

  // Reduced motion draws no sweep; the session still opens after the wait.
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  // Search row, then scroller; min-height: 0 lets it shrink in its column.
  const listBoxStyle = css`
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    border: 1px solid ${COLORS.BORDER_COLOR};
    margin: 8px 0;
    user-select: none;
  `;

  // The search row sits outside: the drag engine measures this as all rows.
  const scrollerStyle = css`
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-height: 0;
    overflow: auto;
  `;

  // Slides as a dragged list's rows do; filled, the new row stands in the place at once.
  const filledContainerStyle = css`
    display: flex;
    flex-direction: column;
    position: relative;
    transition: transform ${DURATION.MOVE} ease;
    &[data-new-session-slot='open'] {
      transform: translateY(var(--new-session-pitch, 0px));
    }
    &[data-new-session-slot='filled'] {
      transition: none;
    }
    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `;

  // Above the column's top, so it slides in with the rows; the scroller clips it at rest.
  const newSessionPlaceStyle = css`
    position: absolute;
    left: 0;
    right: 0;
    top: calc(-1 * var(--new-session-pitch, 0px));
    height: var(--new-session-pitch, 0px);
    pointer-events: none;
  `;

  return (
    <div css={listBoxStyle} data-tour-anchor="sessions">
      <SearchRow
        text={searchText}
        onTextChange={(text) => dispatch(setSearchInputText(text))}
        inputRef={searchInputRef}
        label={t('Search saved tabs')}
        glassInset={SAVED_SEARCH_GLASS_INSET}
        glassBox="tight"
        textInset={SAVED_SEARCH_TEXT_PADDING}
        rowAttribute="data-saved-search"
      />
      <div css={scrollerStyle} ref={listRef}>
        {filteredTabGroups.length === 0 ? (
          // No match: the block is the detail pane's, or this list's when
          // there is no detail pane. An empty list says where sessions will appear.
          noMatchPlace === 'list' ? (
            <NoMatchState query={noMatchQuery} inset={24} scope="saved" />
          ) : isEmpty ? (
            <EmptySavedList />
          ) : null
        ) : (
          <div
            ref={columnRef}
            css={filledContainerStyle}
            data-session-column=""
            data-new-session-slot={
              newSessionSlot === 'closed' ? undefined : newSessionSlot
            }
          >
            {newSessionSlot === 'open' && (
              <div
                aria-hidden="true"
                data-new-session-place=""
                css={[dropBoxStyle(COLORS), newSessionPlaceStyle]}
              />
            )}
            {/* KAN-130. No handleSelector -- a session row contains no nested
                drag area, so the whole row is the handle. No resolveDrop -- a
                session belongs to nothing. Off while searching (KAN-385). */}
            <RowDragArea
              rowIds={sessionIds}
              onMove={handleMoveSession}
              dragKind="session"
              clampDropToEnds
              disabled={isSearching}
            >
              {filteredTabGroups.map((tabGroupData, index) => {
                return (
                  // tabGroupId, not index: this list is filtered by search and
                  // reordered by save, so positions are not stable identities.
                  <DraggableRow
                    key={tabGroupData.tabGroupId}
                    rowId={tabGroupData.tabGroupId}
                  >
                    <TabGroupEntry
                      tabGroupData={tabGroupData}
                      onTabGroupClick={() =>
                        dispatch(showSession(tabGroupData.tabGroupId))
                      }
                      onOpenAllClick={() => {
                        const goToURLText: string = t('Go to URL');
                        dispatch(
                          openAllTabContainer({
                            tabGroupId: tabGroupData.tabGroupId,
                            goToURLText,
                          })
                        );
                      }}
                      onFocusClick={() => {
                        dispatch(
                          requestFocusTabContainer({
                            tabGroupId: tabGroupData.tabGroupId,
                            goToURLText: t('Go to URL'),
                            saveTitle: t('FocusAutoSaveTitle'),
                          })
                        );
                      }}
                      onDeleteClick={() =>
                        dispatch(deleteTabContainer(tabGroupData.tabGroupId))
                      }
                      carryTarget={
                        tabGroupData.tabGroupId === carryTargetId
                          ? {
                              dwellSweep:
                                tabGroupData.tabGroupId === dwellId &&
                                !reducedMotion,
                            }
                          : undefined
                      }
                    />
                    {/* <Divider /> */}
                    {index != filteredTabGroups.length - 1 && <Divider />}
                  </DraggableRow>
                );
              })}
            </RowDragArea>
          </div>
        )}
      </div>
    </div>
  );
}
