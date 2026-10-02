import {
  KeyboardEvent,
  Ref,
  RefObject,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { css } from '@emotion/react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';

import Icon from '../../common/Icon';
import { NormalLabel } from '../../common/Label';
import type { IconName } from '../../common/iconNames';
import { useSearchShortcut } from '../../../hooks/useSearchShortcut';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { useSavedSearch } from '../../../hooks/useSavedSearch';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { formatOpenNowCounts } from '../../../utils/functions/local';
import type { OpenTab, OpenWindow } from '../../../utils/functions/openNow';
import type { MovedTabs } from '../../../utils/functions/openNowMoves';
import {
  openWindowsToSession,
  suggestTitleForWindow,
} from '../../../utils/functions/openWindowsToSession';
import {
  countMatchedTabs,
  matchOpenWindows,
  searchTermOf,
} from '../../../utils/functions/openNowSearch';
import { closeOpenTab, closeOpenWindow } from '../../../utils/functions/reopen';
import { offerReopen } from '../../../redux/reopenOffer';
import {
  clearReopenFocus,
  pendingReopenFocus,
  subscribeReopenFocus,
} from '../../../redux/reopenFocus';
import { saveToTabContainer } from '../../../redux/slices/tabContainerDataStateSlice';
import type { AppDispatch, RootState } from '../../../redux/store';
import { TYPE } from '../../../styles/scale';

import { RowDragArea } from '../rightpane/rowDrag/RowDragArea';
import OpenNowSearchRow from './OpenNowSearchRow';
import OpenNowWindow from './OpenNowWindow';
import {
  OPEN_ITEMS_SCOPE,
  OPEN_TABS_SCOPE,
  useOpenNowDrop,
} from './useOpenNowDrop';

export type OpenNowHeaderAction = {
  icon: IconName;
  // Already translated; it is the control's accessible name and its tooltip.
  label: string;
  onClick: () => void;
};

interface OpenNowPaneProps {
  // null while the first read is in flight; [] when it found nothing to list.
  windows: OpenWindow[] | null;
  // Shown in the header's action row after Collapse all and Save all, in
  // order.
  actions: OpenNowHeaderAction[];
  // The "Open now" heading's id. The pane is a region named by its heading,
  // so its controls are told apart from the saved pane's same-named ones, and
  // the drawer names itself by the same heading (KAN-280 O2).
  headingId: string;
  // The "Open now" heading, for a caller that moves focus to it (the
  // drawer, KAN-280 O2).
  headingRef?: Ref<HTMLHeadingElement>;
  // The search field's text (KAN-330 O14). Held by OpenNowColumn, above the
  // pane ↔ drawer swap, so a resize or a drawer close keeps it.
  searchText: string;
  onSearchTextChange: (text: string) => void;
  // The field. The caller holds it so the drawer can focus it on open (R1).
  searchInputRef: RefObject<HTMLInputElement>;
  // Told of every drag Chrome carried out, with each moved tab's place before
  // and after (KAN-280 Part E), after the drop is kept for ⌘Z. No product
  // caller passes it: the undo record is kept by useOpenNowDrop itself
  // (storeOpenNowDrop), whether or not this is given. The drag tests use it
  // to know a committed drop has settled.
  onMoved?: (moved: MovedTabs) => void;
}

// Stands in for `windows` while the first read is in flight, the same array
// every time, so the drag tables built from it are not rebuilt per render.
const NO_WINDOWS: OpenWindow[] = [];

// The first control inside a window's block: its collapse chevron (an Icon,
// so role="button" on a div).
function firstControlIn(
  element: Element | null | undefined
): HTMLElement | null {
  const control = element?.querySelector('button, [role="button"]');
  return control instanceof HTMLElement ? control : null;
}

// The Switch buttons of the tab rows drawn, top to bottom (KAN-330 O14b).
// Read from the DOM, like rule 8's neighbours: what is drawn is the truth,
// search, folds and all.
function drawnSwitchButtons(pane: HTMLElement | null): HTMLButtonElement[] {
  return [
    ...(pane?.querySelectorAll<HTMLButtonElement>(
      '[data-open-tab-id] > button'
    ) ?? []),
  ];
}

// A tab row's ×, found by its strip's mark rather than by its place in the
// row (KAN-280 O7b).
function closeControlIn(row: Element | null | undefined): HTMLElement | null {
  const control = row?.querySelector('[data-close-tab] [role="button"]');
  return control instanceof HTMLElement ? control : null;
}

// Rule 8's neighbour: the element after `index`, else the one before. None
// when `index` is -1, i.e. the element is not in the list at all.
function neighbourAt(list: Element[], index: number): Element | undefined {
  if (index === -1) return undefined;
  return list[index + 1] ?? list[index - 1];
}

// The Open now pane (KAN-280): the browser's live windows, drawn the way the
// saved-session detail draws a saved one. The caller reads Chrome and hands
// the result in as `windows`; the pane closes tabs and windows itself (O7a)
// and saves them (O13).
export default function OpenNowPane({
  windows,
  actions,
  headingId,
  headingRef,
  searchText,
  onSearchTextChange,
  searchInputRef,
  onMoved,
}: OpenNowPaneProps) {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  const paneRef = useRef<HTMLDivElement>(null);

  // Folded windows, by Chrome window id. Local and unsaved: a live window has
  // no identity worth keeping past this page, and an id Chrome has since
  // closed only means one stale entry nothing reads.
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<number>>(
    () => new Set()
  );

  const listed = windows ?? NO_WINDOWS;
  const tabCount = listed.reduce((sum, w) => sum + w.tabs.length, 0);

  const searchTerm = searchTermOf(searchText);
  // A save lands in the saved list, so it waits for that list's search.
  const { isSearching: isSavedSearching } = useSavedSearch();
  // KAN-330 O14a. Computed once per render; null when no search is held.
  const matches =
    searchTerm === null ? null : matchOpenWindows(listed, searchTerm);

  // KAN-330 F1. Folds made during a search, kept apart from the ones before
  // it, so a search shows every match and clearing it puts the user's own
  // folds back. Each search starts from an empty set.
  const [searchCollapsedIds, setSearchCollapsedIds] = useState<
    ReadonlySet<number>
  >(() => new Set());
  const foldedIds = searchTerm === null ? collapsedIds : searchCollapsedIds;
  const setFoldedIds =
    searchTerm === null ? setCollapsedIds : setSearchCollapsedIds;

  // A search starting (no term -> a term) starts its own folds afresh. Every
  // way the text changes -- typing, the clear ×, Esc -- comes through here.
  const handleSearchTextChange = (text: string) => {
    if (searchTerm === null && searchTermOf(text) !== null) {
      setSearchCollapsedIds(new Set());
    }
    onSearchTextChange(text);
  };

  // What Collapse all acts on: the windows drawn, so during a search it
  // leaves the folds from before alone.
  const drawnWindows =
    matches === null ? listed : listed.filter((w) => matches.has(w.id));

  // Majority rules, as the saved header's toggle (KAN-206): it asks whether
  // any window on screen is open, so unfolding one by hand never leaves it
  // offering the opposite of what the pane needs.
  const anyWindowOpen = drawnWindows.some((w) => !foldedIds.has(w.id));

  // KAN-280 Part E (O11). Tabs and whole groups are dragged here as in a
  // saved session, and a drop moves the real tabs. Groups are shown only
  // with the grant, so without it there is no group to hold (O11e).
  const hasTabGroupsPermission = useSelector(
    (state: RootState) => state.globalState.hasTabGroupsPermission
  );
  // The whole list, not only what a search draws: safe only because drag is
  // off while a search is held (O14c) and a search that starts mid-drag
  // cancels the drag (KAN-335).
  const drop = useOpenNowDrop({
    windows: listed,
    hasTabGroups: hasTabGroupsPermission,
    collapsedIds: foldedIds,
    onMoved,
  });

  const toggleWindow = (id: number) =>
    setFoldedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // KAN-280 rule 8. Focus moves BEFORE the close, read from the rows on
  // screen: the closed row is about to go, and the re-read that drops it can
  // land before Chrome answers, taking the row this would have been measured
  // from with it. A later refresh never moves focus.
  const focusAfterWindowCloses = (windowId: number) => {
    const blocks = [
      ...(paneRef.current?.querySelectorAll('[data-open-window-id]') ?? []),
    ];
    const index = blocks.findIndex(
      (block) => block.getAttribute('data-open-window-id') === String(windowId)
    );
    (
      firstControlIn(neighbourAt(blocks, index)) ??
      document.getElementById(headingId)
    )?.focus();
  };

  // KAN-280 O7b: the neighbour's ×, not its Switch button, so a second Enter
  // closes that tab too instead of switching Chrome away from Tab Keeper. A
  // window with no tab left to list is not listed (toOpenWindows), so a row
  // with no neighbour takes its window row with it: focus goes where closing
  // the window would send it, not to a chevron about to vanish.
  const focusAfterTabCloses = (openWindow: OpenWindow, tab: OpenTab) => {
    const block = paneRef.current?.querySelector(
      `[data-open-window-id="${openWindow.id}"]`
    );
    const rows = [...(block?.querySelectorAll('[data-open-tab-id]') ?? [])];
    const index = rows.findIndex(
      (row) => row.getAttribute('data-open-tab-id') === String(tab.id)
    );
    const next = closeControlIn(neighbourAt(rows, index));
    if (next) next.focus();
    else focusAfterWindowCloses(openWindow.id);
  };

  // KAN-311 (O8c). After Reopen, focus goes to the reopened tab's × or the
  // reopened window's chevron, as soon as a re-read lists it -- or at once,
  // if one already has. A row still missing after REOPEN_FOCUS_MS leaves
  // focus where it is.
  const reopenedRow = useSyncExternalStore(
    subscribeReopenFocus,
    pendingReopenFocus
  );
  useEffect(() => {
    if (reopenedRow === null) return;
    const pane = paneRef.current;
    const control =
      reopenedRow.kind === 'tab'
        ? closeControlIn(
            pane?.querySelector(`[data-open-tab-id="${reopenedRow.tabId}"]`)
          )
        : firstControlIn(
            pane?.querySelector(
              `[data-open-window-id="${reopenedRow.windowId}"]`
            )
          );
    if (control === null) return;
    control.focus();
    clearReopenFocus();
  }, [reopenedRow, windows]);

  // A null close means the tab or window was already gone -- a second press
  // before the re-read, say -- so there is nothing to offer (O8a).
  const handleCloseTab = async (openWindow: OpenWindow, tab: OpenTab) => {
    focusAfterTabCloses(openWindow, tab);
    const item = await closeOpenTab(openWindow, tab);
    if (item) void dispatch(offerReopen(item));
  };

  const handleCloseWindow = async (openWindow: OpenWindow) => {
    focusAfterWindowCloses(openWindow.id);
    const item = await closeOpenWindow(openWindow);
    if (item) void dispatch(offerReopen(item));
  };

  // KAN-280 O13. The snapshot on screen is what is saved, named by rule 1 and
  // announced by rule 2.
  const handleSaveWindow = async (openWindow: OpenWindow) => {
    const title = await suggestTitleForWindow(
      openWindow.id,
      t('New Tab Group')
    );
    void dispatch(
      saveToTabContainer({
        container: openWindowsToSession([openWindow], title, new Date()),
        scope: 'one-window',
      })
    );
  };

  // This window first, as a capture orders them (windowsInScope), so a
  // restore brings the user back where they were. Named from This window
  // alone, which is exactly the name box's suggestion; a This window holding
  // only Tab Keeper is not listed, and falls back.
  const handleSaveAll = async () => {
    const thisWindow = listed.find((w) => w.isThisWindow);
    const ordered = thisWindow
      ? [thisWindow, ...listed.filter((w) => w !== thisWindow)]
      : listed;
    const title = thisWindow
      ? await suggestTitleForWindow(thisWindow.id, t('New Tab Group'))
      : t('New Tab Group');
    void dispatch(
      saveToTabContainer({
        container: openWindowsToSession(ordered, title, new Date()),
        scope: 'all-windows',
      })
    );
  };

  // Copied from RightPane's containerStyle, so the pane sits in its column the
  // way the saved detail does.
  const paneStyle = css`
    display: flex;
    flex-direction: column;
    padding: 8px 8px;
    height: 100%;
  `;

  // Copied from HeroContainerRight's containerStyle and topStyle, less the
  // fill: O1b steps this header down to the list's plain header on the
  // left, so the saved session's own name is what leads. The border stays.
  const headerStyle = css`
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: space-between;
    border: 1px solid ${COLORS.BORDER_COLOR};
    font-family: ${FONT_FAMILY};
    user-select: none;
    width: 100%;
  `;

  const topStyle = css`
    display: flex;
    flex-direction: column;
    width: 100%;
  `;

  // A real heading, drawn as the NormalLabel it replaced (KAN-280 O2): the
  // label's declarations on the h2 itself, since an h2 may hold only phrasing
  // content and NormalLabel renders a div. The h2's own margin and bold are
  // reset, and the label's margin-right is padding here, so the h2 keeps the
  // header's full width and the text the same room.
  //
  // O1b: "Open now" names a panel, not the pane's content, so it steps down
  // from TYPE.SECTION/TEXT_COLOR to TYPE.BODY/LABEL_L1_COLOR -- inside the
  // same 32px line, so the header's height does not move.
  const headingStyle = css`
    display: flex;
    align-items: center;
    height: 32px;
    max-width: 100%;
    min-width: 0;
    margin: 0;
    padding: 0 8px;
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.BODY};
    font-weight: inherit;
    color: ${COLORS.LABEL_L1_COLOR};
    overflow: hidden;
    white-space: nowrap;
  `;

  // NormalLabel's inner box: text-overflow does not apply to a flex
  // container, so the ellipsis lives on the text's own span.
  const headingTextStyle = css`
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  `;

  // The list box: the search row, then the scroller (KAN-330 P2a). The row
  // is pinned by sitting outside the scroller, as the Saved sessions caption
  // is (O3a): a row laid over the top rows would put hidden rows under the
  // pointer during a drag. The box is copied from TabGroupDetailsContainer's
  // containerStyle, less the overflow, which the scroller now holds.
  const listBoxStyle = css`
    display: flex;
    flex-direction: column;
    flex-grow: 1;
    min-height: 0;
    margin-top: 8px;
    border: 1px solid ${COLORS.BORDER_COLOR};
    user-select: none;
  `;

  const scrollerStyle = css`
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-height: 0;
    overflow: auto;
  `;

  // KAN-330 O14b. The pane is mounted only in the tab view, and only one is
  // mounted at a time (side by side, folded, or in the drawer). Focus and
  // select only: the text changes through the row's onTextChange alone.
  const focusSearchField = () => {
    const input = searchInputRef.current;
    if (input === null) return;
    input.focus();
    input.select();
  };
  useSearchShortcut('openNow', focusSearchField);

  // KAN-330 K1. ↓/↑ on a drawn tab's Switch button move to the next or
  // previous one; ↑ on the first goes back to the field. Other targets (a
  // ×, a chevron) keep the keys.
  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = drawnSwitchButtons(paneRef.current);
    const index = buttons.findIndex((button) => button === event.target);
    if (index === -1) return;
    event.preventDefault();
    if (event.key === 'ArrowDown') buttons[index + 1]?.focus();
    else if (index === 0) searchInputRef.current?.focus();
    else buttons[index - 1]?.focus();
  };

  const focusFirstDrawnTab = () =>
    drawnSwitchButtons(paneRef.current)[0]?.focus();

  // O14b: only while a search is held. An empty field must never switch
  // Chrome away from Tab Keeper.
  const switchToFirstDrawnTab = () => {
    if (searchTerm === null) return;
    drawnSwitchButtons(paneRef.current)[0]?.click();
  };

  const emptyStyle = css`
    display: flex;
    height: 100%;
    justify-content: center;
    align-items: center;
  `;

  return (
    <div
      ref={paneRef}
      css={paneStyle}
      role="region"
      aria-labelledby={headingId}
    >
      <div css={headerStyle} data-open-now-header>
        <div css={topStyle}>
          {/* tabIndex -1: focusable from script (the drawer moves focus here
              on open), never a Tab stop. */}
          <h2 id={headingId} ref={headingRef} tabIndex={-1} css={headingStyle}>
            <span css={headingTextStyle}>{t('Open now')}</span>
          </h2>
          {/* No counts while loading, and none for an empty list: "0 Windows"
              says less than the body's own message does. */}
          {listed.length > 0 && (
            <NormalLabel
              value={formatOpenNowCounts(
                listed.length,
                tabCount,
                matches === null ? null : countMatchedTabs(matches),
                t
              )}
              size={TYPE.META}
              color={COLORS.LABEL_L1_COLOR}
              style="padding-top: 2px; padding-left: 8px;"
            />
          )}
          {/* Words, not a dot: every theme's POSITIVE_COLOR measured under
              3:1 against this header (Justine, 2026-09-24). */}
          <NormalLabel
            value={t('Updates as you browse')}
            size={TYPE.META}
            color={COLORS.LABEL_L2_COLOR}
            style="padding-top: 2px; padding-left: 8px;"
          />
        </div>
        <div
          css={css`
            display: flex;
            padding-top: 8px;
          `}
        >
          {/* Only with something to fold; with no windows it would offer
              "Expand all" over an empty list. */}
          {listed.length > 0 && (
            <Icon
              tooltipText={
                anyWindowOpen
                  ? t('Collapse all windows')
                  : t('Expand all windows')
              }
              ariaLabel={
                anyWindowOpen
                  ? t('Collapse all windows')
                  : t('Expand all windows')
              }
              type={anyWindowOpen ? 'unfold_less' : 'unfold_more'}
              onClick={() =>
                setFoldedIds(
                  anyWindowOpen
                    ? new Set(drawnWindows.map((w) => w.id))
                    : new Set()
                )
              }
            />
          )}
          {/* With nothing listed there is nothing to save. */}
          {listed.length > 0 && !isSavedSearching && (
            <Icon
              tooltipText={t('Save every open window as a session')}
              ariaLabel={t('Save every open window as a session')}
              type="library_add"
              onClick={() => void handleSaveAll()}
            />
          )}
          {actions.map((action, index) => (
            <Icon
              // By position: the caller's list is fixed, and two actions may
              // share a label.
              key={index}
              tooltipText={action.label}
              ariaLabel={action.label}
              type={action.icon}
              onClick={action.onClick}
            />
          ))}
        </div>
      </div>
      <div css={listBoxStyle}>
        <OpenNowSearchRow
          text={searchText}
          onTextChange={handleSearchTextChange}
          inputRef={searchInputRef}
          onArrowDown={focusFirstDrawnTab}
          onEnter={switchToFirstDrawnTab}
        />
        <div css={scrollerStyle} onKeyDown={handleListKeyDown}>
          {windows !== null && windows.length === 0 ? (
            <div css={emptyStyle}>
              <NormalLabel
                value={t('No other tabs are open')}
                color={COLORS.LABEL_L2_COLOR}
              />
            </div>
          ) : windows !== null && matches !== null && matches.size === 0 ? (
            <div css={emptyStyle}>
              <NormalLabel
                value={t('NoOpenTabMatches', { text: searchText.trim() })}
                color={COLORS.LABEL_L2_COLOR}
              />
            </div>
          ) : (
            // The saved pane's two lists over every window (TabDragArea,
            // GroupDragArea), under Open now's own scopes: a tab at a time,
            // and a whole group by its title row. No clampDropToEnds: a
            // window's tab list is nested, and a release outside every window
            // must be refused (isInsideList, KAN-132).
            <RowDragArea
              scope={OPEN_TABS_SCOPE}
              rowIds={drop.tabs.rowIds}
              onMove={drop.tabs.onMove}
              dragKind="tab"
              dropsAcrossWindows
              resolveDrop={drop.tabs.resolveDrop}
              onDropTargetChange={drop.tabs.onDropTargetChange}
              landsBesideFixedRow={drop.tabs.landsBesideFixedRow}
              fixedRowsRemovedBy={drop.tabs.fixedRowsRemovedBy}
              gapChangesBy={drop.tabs.gapChangesBy}
              fixedRowSelector="[data-fixed-row-id]"
              landingRange={drop.tabs.landingRange}
              acceptsWindow={drop.tabs.acceptsWindow}
              // KAN-330 O14c: no row can be picked up while a search is held.
              // The same rule as the saved pane's search (KAN-140), keyed on
              // the term because Open now's field has no separate mode.
              disabled={searchTerm !== null}
            >
              <RowDragArea
                scope={OPEN_ITEMS_SCOPE}
                rowIds={drop.items.rowIds}
                onMove={drop.items.onMove}
                dragKind="group"
                dropsAcrossWindows
                handleSelector="[data-group-drag-handle]"
                restoreScrollIfNoDrop
                landingRange={drop.items.landingRange}
                acceptsWindow={drop.items.acceptsWindow}
                disabled={searchTerm !== null}
              >
                {listed.map((openWindow, index) => {
                  // Hidden by the search. `index` is still the window's place
                  // in the WHOLE list, so "Window 3" stays Window 3 (O14a).
                  const matchedTabIds =
                    matches === null
                      ? null
                      : matches.get(openWindow.id) ?? null;
                  if (matches !== null && matchedTabIds === null) return null;
                  return (
                    <OpenNowWindow
                      key={openWindow.id}
                      openWindow={openWindow}
                      index={index}
                      matchedTabIds={matchedTabIds}
                      isOpen={!foldedIds.has(openWindow.id)}
                      onToggle={() => toggleWindow(openWindow.id)}
                      onCloseTab={(tab) => void handleCloseTab(openWindow, tab)}
                      // Whole-window handlers. The row offers them only while
                      // no search is held (O14e), so they never act on tabs
                      // the search hides.
                      onSaveWindow={() => void handleSaveWindow(openWindow)}
                      onCloseWindow={
                        openWindow.isThisWindow
                          ? undefined
                          : () => void handleCloseWindow(openWindow)
                      }
                    />
                  );
                })}
              </RowDragArea>
            </RowDragArea>
          )}
        </div>
      </div>
    </div>
  );
}
