import { useRef, useState } from 'react';

import { css } from '@emotion/react';
import { useTranslation } from 'react-i18next';

import ClickableRow from '../../common/ClickableRow';
import { focusRingOverTickCss } from '../../common/focusRing';
import { renameOnClickStyle } from '../../common/renameOnClickStyle';
import GroupColorPicker from '../../common/GroupColorPicker';
import Icon from '../../common/Icon';
import { RowMarkIcon, RowMarkSlot } from '../../common/RowMarks';
import { NormalLabel } from '../../common/Label';
import { Tag } from '../../common/Tag';
import { useFocusOnRemount } from '../../../hooks/useFocusOnRemount';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { useSavedSearch } from '../../../hooks/useSavedSearch';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { NON_INTERACTIVE_ICON_STYLE } from '../../../utils/constants/common';
import { updateLiveGroup } from '../../../utils/functions/liveTabGroups';
import { resolveFaviconUrl } from '../../../utils/functions/local';
import { renameKeyDown } from '../../../utils/functions/renameKeyDown';
import { placeholderStyle } from '../../../styles/placeholder';
import { openSplitPartners } from '../../../utils/functions/splitPartners';
import {
  focusOpenWindow,
  switchToOpenTab,
} from '../../../utils/functions/openNow';
import type { OpenTab, OpenWindow } from '../../../utils/functions/openNow';
import {
  itemIdOf,
  partitionTabsIntoItems,
  sanitizeTabGroupColor,
} from '../../../utils/functions/tabGroups';
import {
  ADJACENT_GROUP_GAP_PX,
  BAND_MARGIN_PX,
} from '../rightpane/bandSpacing';
import { DraggableRow } from '../rightpane/rowDrag/RowDragArea';
import { useDragState } from '../rightpane/rowDrag/dragContext';
import { markRowContainer } from '../rightpane/rowDrag/dropRules';
import { GroupFrameFollower } from '../rightpane/rowDrag/GroupFrameFollower';
import { DURATION, RADIUS, TYPE, WEIGHT } from '../../../styles/scale';
import { windowLabel } from '../../../utils/functions/windowLabel';
import {
  OPEN_ITEMS_SCOPE,
  OPEN_TABS_SCOPE,
  OPEN_WINDOWS_SCOPE,
} from './useOpenNowDrop';

// WindowEntryContainer's GROUP_TITLE_SIZE, the one documented off-scale size
// (scaleConformance.test.ts). Copied rather than exported from there, for the
// reason the styles below are.
const GROUP_TITLE_SIZE = '0.85rem';

// The row's marks, the pin (O11c), the split (KAN-564), then the speaker
// (O10b), in RowMarkSlot (KAN-566).
const markStyle = css`
  display: flex;
  align-items: center;
`;
// Screen-reader text for the pin and the sound (KAN-280 O11c, O10b), as
// ExportPage's copied status is hidden (KAN-221). The row is
// position: relative, so it stays in.
const descriptionStyle = css`
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
`;

// A held Enter or Space repeats into whatever has focus, and after a close
// that is the next row's × (KAN-280 O7b). Its repeats stop here, in the
// capture phase, before the Icon's own keydown turns each into a click: one
// press closes one tab. Other keys pass, so a held Tab still moves on.
function holdBackRepeatedActivation(event: React.KeyboardEvent) {
  if (!event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.preventDefault();
  event.stopPropagation();
}

// A click whose count is past 1 is a double-click's second click, and it
// does nothing (KAN-280 O7c). On a close, the row below has moved up under
// the pointer, so it would close that row too. Icon's key press arrives
// through click() with a count of 0.
function onFirstClickOnly(action: () => void): React.MouseEventHandler {
  return (event) => {
    if (event.detail > 1) return;
    action();
  };
}

interface OpenNowWindowProps {
  openWindow: OpenWindow;
  // "Window N": its place in Chrome's order, not where it is drawn (KAN-472).
  number: number;
  // KAN-475. A tab drawn with the active mark though not active: the one This
  // window came from. Null for every other window.
  lastUsedTabId: number | null;
  // KAN-330 O14a. The ids of this window's tabs a search matches, or null
  // when no search is held and every tab is drawn. The window itself stays
  // whole: a tab's click and close still act on the real tab. The window's own
  // Save and Close are not offered while a search is held (O14e).
  matchedTabIds: ReadonlySet<number> | null;
  isOpen: boolean;
  onToggle: () => void;
  onCloseTab: (tab: OpenTab) => void;
  onSaveWindow: () => void;
  // Absent for "This window": closing it would close the tab view itself.
  onCloseWindow?: () => void;
}

// One live window in the Open now pane (KAN-280): its row, its group bands
// and its tab rows, with the fold, click-to-switch and the close controls
// (O7a), and Save window (O13). The pane owns what a close or a save does.
export default function OpenNowWindow({
  openWindow,
  number,
  lastUsedTabId,
  matchedTabIds,
  isOpen,
  onToggle,
  onCloseTab,
  onSaveWindow,
  onCloseWindow,
}: OpenNowWindowProps) {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  // KAN-568. The saved band's rename (WindowEntryContainer), on Chrome's group: the draft is seeded at start (KAN-51).
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState('');
  const groupRenameCancelled = useRef(false);
  const titleFocus = useFocusOnRemount();
  // Open now re-reads ~50ms after Chrome's event, and measured, the old name showed again for those frames.
  // So the new one stands in while Chrome still reports the name it replaced (or until the update fails).
  const [renamed, setRenamed] = useState<{
    groupId: string;
    replaced: string;
    title: string;
  } | null>(null);
  const titleOf = (group: { groupId: string; title: string }) =>
    renamed?.groupId === group.groupId && renamed.replaced === group.title
      ? renamed.title
      : group.title;
  const liveTitle = renamed
    ? openWindow.groups.find((group) => String(group.id) === renamed.groupId)
        ?.title
    : undefined;
  // Once the read moves on, from Chrome or from this edit, the stand-in is spent (set during render, not in an effect).
  if (renamed && liveTitle !== renamed.replaced) setRenamed(null);
  const startEditingGroup = (group: { groupId: string; title: string }) => {
    groupRenameCancelled.current = false;
    setGroupDraft(titleOf(group));
    setEditingGroupId(group.groupId);
  };
  // Opening and closing the field writes nothing; a blank leaves the group unnamed, as Chrome allows.
  const commitGroupRename = (group: { groupId: string; title: string }) => {
    if (groupRenameCancelled.current) return;
    setEditingGroupId(null);
    if (titleOf(group) !== groupDraft) {
      const edit = {
        groupId: group.groupId,
        replaced: group.title,
        title: groupDraft,
      };
      setRenamed(edit);
      void updateLiveGroup(Number(group.groupId), { title: groupDraft }).then(
        (updated) => {
          if (!updated) setRenamed((now) => (now === edit ? null : now));
        }
      );
    }
  };
  const cancelGroupRename = () => {
    groupRenameCancelled.current = true;
    setEditingGroupId(null);
  };

  // How far this window's block moves to make room for a row landing in
  // another one (KAN-184), as a saved window's does. Either list can carry a
  // row across windows, and only one of them is ever dragging.
  const windowKey = String(openWindow.id);
  const tabDrag = useDragState(OPEN_TABS_SCOPE);
  const itemDrag = useDragState(OPEN_ITEMS_SCOPE);
  const windowShift =
    (tabDrag?.windowShifts[windowKey] ?? 0) ||
    (itemDrag?.windowShifts[windowKey] ?? 0);

  const [isParentHovered, setIsParentHovered] = useState(false);
  // By Chrome tab id, not by position, for KAN-127's reason: a re-read (and,
  // later, a drag) moves rows, and a position-keyed flag would then reveal
  // whichever tab moved into the hovered slot.
  const [hoveredTabId, setHoveredTabId] = useState<number | null>(null);

  // Copied from WindowEntryContainer's own containerStyle, parentStyle,
  // parentLeftStyle, childrenContainerStyle, childrenStyle, childLeftStyle and
  // windowChildLinkStyle (WindowEntryContainer.tsx:334-478 when copied), NOT
  // imported: the drag engine owns that file's CSS
  // channels, so the saved pane must not change for this one. Live and saved
  // rows must still measure the same (KAN-280, "Rows look like saved rows"),
  // which e2e/open-now.spec.ts tests 7, 7b and 7c pin.
  const containerStyle = css`
    display: flex;
    flex-direction: column;
    font-family: ${FONT_FAMILY};
    margin-bottom: 8px;
  `;

  // O14e. While a search is held its Save window and Close window would act on
  // tabs the search hides, with nothing on screen saying so, so the strip is
  // not rendered at all (out of the tab order too). Clearing the search
  // brings both back.
  const offersWindowActions = matchedTabIds === null;
  const { isSearching: isSavedSearching } = useSavedSearch();
  // KAN-331 O15. The row takes you to its window: not "This window" (W2 A,
  // you are in it), and not while a search is held (S2). Only a row that
  // does this shades on hover (T2): "This window"'s strip still appears, on
  // its own patch, without the row looking clickable.
  const goesToWindow = !openWindow.isThisWindow && matchedTabIds === null;

  const parentStyle = css`
    position: relative;
    display: flex;
    justify-content: space-between;
    ${
      goesToWindow ? `&:hover { background-color: ${COLORS.HOVER_COLOR}; }` : ''
    }
  `;

  const parentLeftStyle = css`
    display: flex;
    align-items: center;
    flex-grow: 1;
    min-width: 0;
  `;

  // The action strips (KAN-280 O7a), copied from WindowEntryContainer's
  // parentRightStyle and childRightStyle for the same reason, less the
  // saved row's editing and search cases. KAN-100: the mask lands in one
  // frame with the row's fill and only the icons ease, or the row fills in
  // two halves with an edge between them. Keyboard focus reveals them too
  // (KAN-68), and only keyboard focus: after a mouse close, focus moves to
  // the next row's × (O7b), and :focus-within would show it under a pointer
  // that has moved on (KAN-280 O7d). :has(:focus-visible), as KAN-94's
  // TabGroupEntry does.
  const parentRightStyle = css`
    display: flex;
    position: absolute;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
    background-color: ${isParentHovered ? COLORS.HOVER_COLOR : 'transparent'};
    & > * {
      opacity: ${isParentHovered ? 1 : 0};
      transition: opacity ${DURATION.COLOR} ease-out;
    }
    &:has(:focus-visible) {
      background-color: ${COLORS.HOVER_COLOR};
      & > * {
        opacity: 1;
      }
    }
  `;

  const childRightStyle = (tabId: number) => css`
    position: absolute;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
    background-color: ${
      hoveredTabId === tabId ? COLORS.HOVER_COLOR : 'transparent'
    };
    & > * {
      opacity: ${hoveredTabId === tabId ? 1 : 0};
      transition: opacity ${DURATION.COLOR} ease-out;
    }
    &:has(:focus-visible) {
      background-color: ${COLORS.HOVER_COLOR};
      & > * {
        opacity: 1;
      }
    }
  `;

  const childrenContainerStyle = css`
    padding-left: 70px;
  `;

  const childrenStyle = css`
    position: relative;
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    &:hover {
      background-color: ${COLORS.HOVER_COLOR};
    }
  `;

  // A plain string, not css``: handed to ClickableRow's `style` prop.
  const childLeftStyle = `
    display: flex;
    align-items: center;
    flex-grow: 1;
    min-width: 0;
  `;

  const windowChildLinkStyle = css`
    text-decoration: none;
    color: inherit;
    display: flex;
    align-items: center;
    height: 100%;
    flex-grow: 1;
    min-width: 0;
    margin-left: 4px;
    margin-right: 4px;
    cursor: pointer;
  `;

  // The window glyph and the title, as one box: a button when the row goes
  // to its window, a plain box otherwise. The same layout either way, so a
  // row's title does not move when it stops being a button (S2).
  const windowHeaderStyle = `
    display: flex;
    align-items: center;
    flex-grow: 1;
    min-width: 0;
    height: 100%;
  `;

  const windowTitleStyle = css`
    display: flex;
    align-items: center;
    height: 100%;
    flex-grow: 1;
    min-width: 0;
    padding-right: 9px;
  `;

  const title = windowLabel('', number, t('Window')).text;

  // KAN-280 Part F (D3 A). The row's glyph and title pick the window up; the chevron and the actions sit outside it.
  const windowHeader = (
    <div data-open-window-drag-handle="" css={css(windowHeaderStyle)}>
      <Icon type="web_asset" style={NON_INTERACTIVE_ICON_STYLE} />
      <div css={windowTitleStyle}>
        <NormalLabel
          value={title}
          color={COLORS.TEXT_COLOR}
          size={TYPE.BODY}
          style="padding-left: 8px; height: 100%; max-width: 100%;"
        />
        {openWindow.isThisWindow && (
          <Tag
            value={t('This window')}
            style="margin-left: 8px; flex-shrink: 0; white-space: nowrap;"
          />
        )}
      </div>
    </div>
  );

  // The adapters partitionTabsIntoItems takes, keyed back to the OpenTab by id
  // afterwards. One partition rule for both panes, so a live group draws where
  // the saved one would -- and the one the drag geometry counts rows with
  // (useOpenNowDrop), so a drop's index names the row drawn there (KAN-131).
  // That geometry reads the whole window, not only what a search draws: safe
  // because under a search a tab drag only carries out (O14c amended), which
  // lands nowhere here, and a search that starts mid-drag ends an in-pane
  // drag (KAN-335).
  // KAN-330 O14a. What this window draws: every tab, or a search's matches.
  // Only drawing narrows; the handlers below still get the whole window.
  const drawnTabs =
    matchedTabIds === null
      ? openWindow.tabs
      : openWindow.tabs.filter((tab) => matchedTabIds.has(tab.id));
  // KAN-564. Each drawn half of a live split, and its other half.
  const splitPartners = openSplitPartners(drawnTabs);
  const tabsById = new Map(openWindow.tabs.map((tab) => [String(tab.id), tab]));
  const items = partitionTabsIntoItems(
    drawnTabs.map((tab) => ({
      tabId: String(tab.id),
      favicon: tab.favIconUrl,
      title: tab.title,
      url: tab.url,
      chromeGroupId: tab.groupId === null ? undefined : String(tab.groupId),
    })),
    openWindow.groups.map((group) => ({
      groupId: String(group.id),
      title: group.title,
      color: group.color,
    }))
  );

  function renderTab(tab: OpenTab) {
    // KAN-280 O10b: the speaker shows Chrome's sound and changes nothing.
    // Tab Keeper never mutes, because Chrome's own controls cannot undo an
    // extension's mute (KAN-315, measured). Muted wins over playing.
    // t() on literals: keyCoverage cannot see a key passed as a variable.
    const sound = tab.muted
      ? t('Audio muted')
      : tab.audible
        ? t('Audio playing')
        : null;
    const soundId = `open-now-sound-${tab.id}`;
    // "Last used tab" (KAN-475), "Pinned" (O11c), then the sound. One id
    // each, so each phrase stays the locale's own and the browser joins them
    // (no joiner, KAN-307).
    const pinnedId = `open-now-pinned-${tab.id}`;
    const isLastUsed = tab.id === lastUsedTabId;
    const lastUsedId = `open-now-last-used-${tab.id}`;
    // KAN-564. Both halves of a split are on screen, so the active mark
    // covers the pair (P), whichever half Chrome calls active.
    const partner = splitPartners.get(tab.id);
    const splitId = `open-now-split-${tab.id}`;
    const splitText =
      partner === undefined
        ? null
        : t('In a split view with {{title}}', { title: partner.title });
    const isFront = (other: OpenTab) =>
      other.active || other.id === lastUsedTabId;
    const isOnScreen =
      isFront(tab) || (partner !== undefined && isFront(partner));
    const describedBy = [
      ...(isLastUsed ? [lastUsedId] : []),
      ...(tab.pinned ? [pinnedId] : []),
      ...(splitText === null ? [] : [splitId]),
      ...(sound === null ? [] : [soundId]),
    ].join(' ');
    return (
      <div
        key={tab.id}
        css={childrenStyle}
        data-open-tab-id={tab.id}
        onMouseEnter={() => setHoveredTabId(tab.id)}
        onMouseLeave={() => setHoveredTabId(null)}
      >
        <ClickableRow
          ariaLabel={t('Switch to tab') + ': ' + tab.title}
          ariaCurrent={tab.active}
          ariaDescribedBy={describedBy === '' ? undefined : describedBy}
          // Chrome rejects when the tab closed after this row was drawn. There
          // is nothing to switch to, and the next read drops the row.
          onClick={() => void switchToOpenTab(tab).catch(() => undefined)}
          style={childLeftStyle}
        >
          <Icon
            faviconUrl={resolveFaviconUrl(tab.favIconUrl, tab.url)}
            type="globe"
            style={`&:hover {background-color: unset;}`}
          />
          <div css={windowChildLinkStyle}>
            <NormalLabel
              value={tab.title}
              color={COLORS.TEXT_COLOR}
              size={TYPE.BODY}
              // KAN-567 B. The tab on screen is marked by its title's weight
              // alone, so nothing competes with a group's strip and hover
              // stays the row's only fill (WEIGHT.ACTIVE_ROW).
              style={`padding-left: 4px; height: 100%; max-width: 100%;${
                isOnScreen ? ` font-weight: ${WEIGHT.ACTIVE_ROW};` : ''
              }`}
            />
          </div>
          {(tab.pinned || splitText !== null || sound !== null) && (
            // Inside the Switch button, so a click on a mark switches to the
            // tab, where Chrome's own pin and mute are. A presentational Icon
            // is aria-hidden; the descriptions below say the pin and the
            // sound instead.
            <RowMarkSlot>
              {tab.pinned && (
                <span data-pin css={markStyle}>
                  <RowMarkIcon type="keep" />
                </span>
              )}
              {splitText !== null && (
                <span data-split css={markStyle}>
                  <RowMarkIcon type="view_column_2" tooltipText={splitText} />
                </span>
              )}
              {sound !== null && (
                <span data-speaker css={markStyle}>
                  <RowMarkIcon type={tab.muted ? 'volume_off' : 'volume_up'} />
                </span>
              )}
            </RowMarkSlot>
          )}
        </ClickableRow>
        {isLastUsed && (
          <span id={lastUsedId} css={descriptionStyle}>
            {t('Last used tab')}
          </span>
        )}
        {tab.pinned && (
          <span id={pinnedId} css={descriptionStyle}>
            {t('Pinned')}
          </span>
        )}
        {splitText !== null && (
          <span id={splitId} css={descriptionStyle}>
            {splitText}
          </span>
        )}
        {sound !== null && (
          <span id={soundId} css={descriptionStyle}>
            {sound}
          </span>
        )}
        {/* data-row-actions: the stylesheet's hook for hiding the strip
            during a drag (KAN-135), which an emotion class cannot give it.
            data-close-tab: where the pane finds this row's × after a close
            (KAN-280 O7b); the strip holds the × alone. */}
        <div
          data-row-actions
          data-close-tab
          css={childRightStyle(tab.id)}
          onKeyDownCapture={holdBackRepeatedActivation}
        >
          <Icon
            tooltipText={t('Close tab')}
            ariaLabel={t('Close tab') + ': ' + tab.title}
            type="close"
            onClick={onFirstClickOnly(() => onCloseTab(tab))}
          />
        </div>
      </div>
    );
  }

  // A tab row, as a row of the `tabs` list (KAN-280 Part E).
  const renderTabRow = (tabId: string) => {
    const tab = tabsById.get(tabId);
    return tab ? (
      <DraggableRow key={tabId} scope={OPEN_TABS_SCOPE} rowId={tabId}>
        {renderTab(tab)}
      </DraggableRow>
    ) : null;
  };

  return (
    // KAN-280 Part F (D3 A). The whole block is the windows list's row, picked up by its header's handle.
    <DraggableRow scope={OPEN_WINDOWS_SCOPE} rowId={String(openWindow.id)}>
      {/* data-drop-window-id: the whole block is what the drag engine
      hit-tests for "this window" (KAN-132), header and a folded window
      included. Its shift is published back so that hit test can subtract it,
      and is not eased, as in WindowEntryContainer (KAN-184). */}
      <div
        css={containerStyle}
        data-open-window-id={openWindow.id}
        data-drop-window-id={windowKey}
        data-window-shift={windowShift || undefined}
        style={{
          transform: windowShift ? `translateY(${windowShift}px)` : undefined,
        }}
      >
        <div
          css={parentStyle}
          // The e2e specs find a window's row by this.
          data-window-row
          onMouseEnter={() => setIsParentHovered(true)}
          onMouseLeave={() => setIsParentHovered(false)}
        >
          <div css={parentLeftStyle}>
            <Icon
              tooltipText={isOpen ? t('Collapse') : t('Expand')}
              // Names its window, as the tab rows name their tab, so N windows
              // are not N identical "Collapse" buttons (KAN-280).
              ariaLabel={(isOpen ? t('Collapse') : t('Expand')) + ': ' + title}
              ariaExpanded={isOpen}
              type={isOpen ? 'expand_less' : 'expand_more'}
              onClick={onToggle}
            />
            {goesToWindow ? (
              <ClickableRow
                ariaLabel={t('Go to window') + ': ' + title}
                tooltipText={t('Go to window')}
                // Chrome rejects when the window closed after this row was
                // drawn. There is nothing to go to, and the next read drops
                // the row. Nothing runs after the focus (O15).
                onClick={() =>
                  void focusOpenWindow(openWindow.id).catch(() => undefined)
                }
                style={windowHeaderStyle}
              >
                {windowHeader}
              </ClickableRow>
            ) : (
              <div css={css(windowHeaderStyle)}>{windowHeader}</div>
            )}
          </div>
          {offersWindowActions && (
            <div data-row-actions css={parentRightStyle}>
              {!isSavedSearching && (
                <Icon
                  tooltipText={t('Save window as a session')}
                  ariaLabel={t('Save window as a session') + ': ' + title}
                  type="add_box"
                  onClick={onSaveWindow}
                />
              )}
              {onCloseWindow && (
                <Icon
                  tooltipText={t('Close window')}
                  ariaLabel={t('Close window') + ': ' + title}
                  type="close"
                  onClick={onFirstClickOnly(onCloseWindow)}
                />
              )}
            </div>
          )}
        </div>
        {isOpen && (
          // markRowContainer: this box holds one window's worth of the
          // pane-wide lists, so no row's footprint is measured on it (KAN-132).
          <div css={childrenContainerStyle} ref={markRowContainer}>
            {items.map((item, itemIndex) => {
              // A loose tab is one row of each list: the `items` list, where a
              // group is one row too, and the `tabs` list inside it.
              if (item.kind === 'tab') {
                return (
                  <DraggableRow
                    key={itemIdOf(item)}
                    scope={OPEN_ITEMS_SCOPE}
                    rowId={itemIdOf(item)}
                  >
                    {renderTabRow(item.tab.tabId)}
                  </DraggableRow>
                );
              }
              // Already a TabGroupColor on the way in; the partition hands it
              // back as the saved shape's string, so it is narrowed again.
              const color = sanitizeTabGroupColor(item.group.color);
              const groupTitle = titleOf(item.group);
              const groupName = groupTitle || t('Unnamed group');
              return (
                // The saved band, at rest (KAN-280: a live grouped tab sits
                // exactly where a saved one does). Copied, not shared, for the
                // reason the styles above are:
                // (line numbers as of the copy; the names are what to search)
                //   band        the role="group" band's css in
                //               WindowEntryContainer.tsx (945-966)
                //   strip       bandStyle in GroupColorPicker.tsx (101-125)
                //   column      the band's flex: 1 column in
                //               WindowEntryContainer.tsx (1073-1077)
                //   title row   the data-group-drag-handle row and its
                //               ClickableRow style (1098-1120, 1218)
                //   title label groupTitleLabel in
                //               WindowEntryContainer.tsx (516-522)
                // With the drag rules too (KAN-280 Part E): the band is the
                // `items` list's row for its group, and its frame follows a tab
                // drag through GroupFrameFollower, as a saved band's does. The
                // strip and title are the saved band's controls (KAN-568).
                <DraggableRow
                  key={itemIdOf(item)}
                  scope={OPEN_ITEMS_SCOPE}
                  rowId={itemIdOf(item)}
                >
                  <div
                    data-band-id={item.group.groupId}
                    role="group"
                    aria-label={groupName}
                    data-after-group={
                      itemIndex > 0 && items[itemIndex - 1].kind === 'group'
                        ? ''
                        : undefined
                    }
                    data-before-group={
                      items[itemIndex + 1]?.kind === 'group' ? '' : undefined
                    }
                    css={css`
                      display: flex;
                      align-items: stretch;
                      margin: ${BAND_MARGIN_PX}px 0;
                      &[data-after-group] {
                        margin-top: ${ADJACENT_GROUP_GAP_PX}px;
                      }
                      /* KAN-186: the held group paints its row's hover fill,
                       so its strip's margin is no window onto the rows it
                       passes over. */
                      [data-drag-held] & {
                        background-color: ${COLORS.HOVER_COLOR};
                      }
                      /* KAN-169: a drop that empties this group fades its
                       title row and strip as the rows below close up. */
                      &[data-drag-removed] [data-group-drag-handle],
                      &[data-drag-removed] [data-group-color-strip] {
                        opacity: 0;
                        transition: opacity ${DURATION.MOVE} ease;
                      }
                      /* KAN-164: a tab released here joins this group, which
                       answers in its own colour. */
                      &[data-drop-target] {
                        background-color: color-mix(
                          in srgb,
                          var(--band-color, transparent) 18%,
                          transparent
                        );
                        border-radius: ${RADIUS.SQUARE};
                      }
                    `}
                  >
                    <GroupFrameFollower
                      groupId={item.group.groupId}
                      scope={OPEN_TABS_SCOPE}
                    />
                    {/* KAN-568. The saved band's picker: Chrome's group, so the next read shows the colour. */}
                    <GroupColorPicker
                      color={color}
                      ariaLabel={t('Change group color') + ': ' + groupName}
                      onSelect={(picked) =>
                        void updateLiveGroup(Number(item.group.groupId), {
                          color: picked,
                        })
                      }
                    />
                    <div
                      css={css`
                        flex: 1;
                        min-width: 0;
                      `}
                    >
                      {/* data-group-drag-handle: a group is held by this row
                      (KAN-160). data-fixed-row-id: drawn in the tab list
                      but not one of its rows (KAN-166); it glides with the
                      rows (KAN-165). Fills on hover as the saved row does. */}
                      <div
                        data-group-drag-handle
                        data-fixed-row-id={item.group.groupId}
                        css={css`
                          position: relative;
                          display: flex;
                          align-items: center;
                          min-height: 32px;
                          transition: transform ${DURATION.MOVE} ease;
                          ${focusRingOverTickCss(
                            COLORS,
                            '&:has(> input:focus-visible)'
                          )}
                          /* Keyboard focus only (KAN-636), in its own rule beside :hover (KAN-94). */
                          &:hover {
                            background-color: ${COLORS.HOVER_COLOR};
                          }
                          &:has(:focus-visible) {
                            background-color: ${COLORS.HOVER_COLOR};
                          }
                        `}
                      >
                        {editingGroupId === item.group.groupId ? (
                          <>
                            <input
                              value={groupDraft}
                              aria-label={t('Rename group') + ': ' + groupName}
                              onBlur={() => commitGroupRename(item.group)}
                              onChange={(e) => setGroupDraft(e.target.value)}
                              placeholder={t('Name this group')}
                              onKeyDown={(e) =>
                                renameKeyDown(
                                  e,
                                  () => {
                                    titleFocus.ask(item.group.groupId);
                                    commitGroupRename(item.group);
                                  },
                                  () => {
                                    titleFocus.ask(item.group.groupId);
                                    cancelGroupRename();
                                  }
                                )
                              }
                              autoFocus
                              css={css`
                                color: ${COLORS.TEXT_COLOR};
                                background-color: ${COLORS.PRIMARY_COLOR};
                                border: 1px solid ${COLORS.CONTROL_BORDER_COLOR};
                                display: flex;
                                align-items: center;
                                font-family: ${FONT_FAMILY};
                                font-size: ${GROUP_TITLE_SIZE};
                                padding-left: 8px;
                                align-self: stretch;
                                width: 100%;
                                min-width: 0;
                                &:focus {
                                  outline: none;
                                }
                                ${placeholderStyle(COLORS.PLACEHOLDER_COLOR)}
                              `}
                            />
                            {/* preventDefault keeps focus in the input, so onClick is the one commit path. */}
                            <span
                              css={css`
                                position: absolute;
                                top: 50%;
                                right: 0;
                                transform: translateY(-50%);
                                display: flex;
                                align-items: center;
                                z-index: 1;
                              `}
                              onMouseDown={(e) => e.preventDefault()}
                            >
                              <Icon
                                tooltipText={t('Save changes')}
                                ariaLabel={t('Save changes')}
                                type="done"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  titleFocus.ask(item.group.groupId);
                                  commitGroupRename(item.group);
                                }}
                              />
                            </span>
                          </>
                        ) : (
                          // Shrunk to its text, as the saved title is, so the rest of the row is only a drag handle.
                          // The ghost reaches 4px past the text without padding, as the saved band's (KAN-631, D10).
                          <ClickableRow
                            ariaLabel={t('Rename group') + ': ' + groupName}
                            onClick={() => startEditingGroup(item.group)}
                            buttonRef={titleFocus.refFor(item.group.groupId)}
                            style={
                              'display: flex; align-items: center; align-self: stretch; min-width: 0; box-sizing: border-box; flex: 0 1 auto; max-width: 100%;' +
                              renameOnClickStyle(COLORS, COLORS.HOVER_COLOR) +
                              '&::before { right: -4px; }'
                            }
                          >
                            <NormalLabel
                              value={groupName}
                              color={
                                groupTitle
                                  ? COLORS.LABEL_L2_COLOR
                                  : COLORS.LABEL_L3_COLOR
                              }
                              size={GROUP_TITLE_SIZE}
                              style={`padding-left: 4px;${
                                groupTitle ? '' : ' font-style: italic;'
                              }`}
                            />
                          </ClickableRow>
                        )}
                      </div>
                      {/* data-group-tabs: the held group folds to its title
                      row (App.css, KAN-160). The zero-height marker is the
                      group's tail in the drawn list (KAN-175). */}
                      <div data-group-tabs>
                        {item.tabs.map((tab) => renderTabRow(tab.tabId))}
                        <div
                          aria-hidden="true"
                          data-fixed-row-id={`${item.group.groupId}:tail`}
                          css={css`
                            height: 0;
                          `}
                        />
                      </div>
                    </div>
                  </div>
                </DraggableRow>
              );
            })}
          </div>
        )}
      </div>
    </DraggableRow>
  );
}
