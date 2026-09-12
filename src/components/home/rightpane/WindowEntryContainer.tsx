import React, {
  MouseEventHandler,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import ClickableRow from '../../common/ClickableRow';
import Icon from '../../common/Icon';
import OverflowMenu from '../../common/OverflowMenu';
import GroupColorPicker from '../../common/GroupColorPicker';
import { NormalLabel } from '../../common/Label';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { AppDispatch, RootState } from '../../../redux/store';
import {
  resolveTabUrl,
  resolveFaviconUrl,
} from '../../../utils/functions/local';
import { NON_INTERACTIVE_ICON_STYLE } from '../../../utils/constants/common';
import {
  deleteTab,
  tabData,
  updateChromeTabGroupTitle,
  addCurrTabToChromeGroupInternal,
  ungroupChromeTabGroup,
  deleteChromeTabGroupInternal,
  updateChromeTabGroupColor,
  moveTabInternal,
  moveChromeGroupInternal,
} from '../../../redux/slices/tabContainerDataStateSlice';
import { useTranslation } from 'react-i18next';
import { v4 as uuidv4 } from 'uuid';
import {
  TAB_GROUP_COLOR_HEX,
  sanitizeTabGroupColor,
  partitionTabsIntoItems,
  itemIdOf,
  groupIdOfItemId,
} from '../../../utils/functions/tabGroups';
import type {
  chromeTabGroupData,
  GroupRun,
} from '../../../utils/functions/tabGroups';
import { applyTabGroups } from '../../../utils/functions/windows';

import { groupFrameOffset } from '../../../utils/functions/groupFrame';
import { RowDragArea, DraggableRow } from './rowDrag/RowDragArea';
import { useDragState } from './rowDrag/dragContext';
import { bandAt } from './rowDrag/dropRules';

interface WindowEntryContainerProps {
  title: string;
  tabs: tabData[];
  chromeTabGroups?: chromeTabGroupData[];
  tabGroupId: string;
  windowId: string;
  /**
   * Takes no event -- its only caller passes a zero-argument arrow. It was
   * typed MouseEventHandler, which is what let the keyboard path activate it
   * through `handleWindowClick(e as any)` with a KeyboardEvent.
   */
  onWindowTitleClick: () => void;
  onUpdateWindowGroupTitle: (newTitle: string) => void;
  onAddCurrTabToWindowClick: MouseEventHandler;
  onDeleteClick: MouseEventHandler;
}

// KAN-165. Carries a group's frame along with its tabs.
//
// The engine translates individual tab rows. A group's title row and colour
// strip are not rows in that list, so nothing moved them, and members slid out
// through their own group -- measured, the first member of a three-tab group
// ended 2px ABOVE its own title.
//
// Rendered INSIDE the drag area because that is the only place the live drag
// can be read; WindowEntryContainer itself sits outside the area's provider.
// It draws nothing.
//
// The two parts are moved through the DOM rather than by prop, because they are
// rendered in different places -- the strip by GroupColorPicker -- and
// threading a per-move offset into a component with no other reason to know
// about dragging would be worse than this. The offset changes only when the
// landing index does, not on every pointer move.
const GroupFrameFollower: React.FC<{ memberIndices: number[] }> = ({
  memberIndices,
}) => {
  const drag = useDragState('tabs');
  const offset = groupFrameOffset(drag, memberIndices);
  const anchor = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    const band = anchor.current?.closest<HTMLElement>('[data-band-id]');
    if (!band) return;
    const transform = offset ? `translateY(${offset}px)` : '';
    for (const part of [
      band.querySelector<HTMLElement>('[data-group-color-strip]'),
      band.querySelector<HTMLElement>('[data-group-drag-handle]'),
    ]) {
      if (part) part.style.transform = transform;
    }
  }, [offset]);

  return <span ref={anchor} hidden />;
};

const WindowEntryContainer: React.FC<WindowEntryContainerProps> = ({
  title,
  tabs,
  chromeTabGroups,
  tabGroupId,
  windowId,
  onWindowTitleClick,
  onUpdateWindowGroupTitle,
  onAddCurrTabToWindowClick,
  onDeleteClick,
}) => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();

  const dispatch: AppDispatch = useDispatch();

  const [windowOpenState, setWindowOpenState] = useState(true);
  const [newTitle, setNewTitle] = useState(title);
  const [isEditing, setIsEditing] = useState(false);
  const [isParentHovered, setIsParentHovered] = useState(false);
  // Which Chrome group is being renamed, by its capture-time uuid -- not a
  // boolean, because one window can hold several groups and a boolean would
  // put every one of them into edit mode at once.
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState('');
  // Which group's overflow menu is open, so its action strip can outrank its
  // siblings. Every strip is a stacking context of its own (transform), so
  // equal z-indexes leave DOM order deciding -- and a LOWER group's strip then
  // painted over an open menu belonging to the group above it.
  const [openMenuGroupId, setOpenMenuGroupId] = useState<string | null>(null);
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);

  const isSearchPanel = useSelector(
    (state: RootState) => state.globalState.isSearchPanel
  );

  // KAN-131. `tabs` here is whatever the pane handed down, and under a live
  // search that is a SUBSET of the stored window -- filterTabGroups narrows a
  // window's tabs, not just which windows are shown. A drag reports an index
  // into the rows on screen and moveTabInternal applies it to the stored
  // array, so in a narrowed list the tab lands somewhere the user never
  // pointed at, silently, and the session is dirtied for a cloud write.
  //
  // isSearchPanel, not isSearchActive (KAN-140). This comment used to argue
  // the opposite -- an open panel with an empty box filters nothing, so the
  // two lists agree and dragging is safe -- which is true and is not the
  // point. Guarding on the box's contents means the same gesture on the same
  // rows works or does nothing depending on a transient value, with no visible
  // tell, and makes the safety property depend on a keystroke racing a pointer
  // gesture. The mode is the stable thing to ask about.

  // Gates rendering on the LIVE permission, not on whether the data is
  // present. A session synced from a device that had the permission still
  // carries chromeTabGroups on a device that never granted it, and
  // applyTabGroups silently no-ops in that case (it feature-detects
  // chrome.tabGroups and returns without restoring the grouping) -- so
  // showing coloured bands here would promise a grouping restore will not
  // keep. Falling back to the flat, ungrouped rendering is honest about
  // what the pane can actually do; the individual tabs still render either
  // way, only the grouping UI disappears.
  const hasTabGroupsPermission = useSelector(
    (state: RootState) => state.globalState.hasTabGroupsPermission
  );

  const tabIds = useMemo(() => tabs.map((tab) => tab.tabId), [tabs]);
  // Position by id, so the run rendering does not need indexOf per row.
  const indexOfTab = useMemo(
    () => new Map(tabs.map((tab, i) => [tab.tabId, i])),
    [tabs]
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
  // Written straight to the DOM rather than held in React state, because it
  // changes as the pointer moves and a re-render per move is the cost this
  // drag engine is built to avoid -- the same reason `data-drag-held` is set
  // this way (KAN-160). React never touches these, so a re-render cannot drop
  // them.
  const groupColorHex = useMemo(() => {
    const byId = new Map<string, string>();
    for (const group of chromeTabGroups ?? []) {
      byId.set(
        group.groupId,
        TAB_GROUP_COLOR_HEX[sanitizeTabGroupColor(group.color)]
      );
    }
    return byId;
  }, [chromeTabGroups]);

  const markDropTargetBand = useCallback(
    (target: string | undefined, container: HTMLElement | null) => {
      if (!container) return;
      // Scoped to the container that answered, so a band in another window
      // cannot light up alongside it.
      for (const band of container.querySelectorAll<HTMLElement>(
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

  const handleMove = useCallback(
    (tabId: string, toIndex: number, toChromeGroupId?: string) => {
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
    [dispatch, tabGroupId, windowId]
  );

  // The window's top-level rows as drawn: each loose tab, and each group as
  // one item (KAN-160). The group drag indexes THIS list, and
  // moveChromeGroupInternal rebuilds it with the same function (KAN-131: an
  // index is only valid in the list that produced it).
  const items = useMemo(
    () =>
      partitionTabsIntoItems(
        tabs,
        hasTabGroupsPermission ? chromeTabGroups : undefined
      ),
    [tabs, chromeTabGroups, hasTabGroupsPermission]
  );
  const itemIds = useMemo(() => items.map(itemIdOf), [items]);

  // Where in the window's tab list each group's first member sits.
  const groupFirstIndex = useMemo(() => {
    const byId = new Map<string, number>();
    for (const item of items) {
      if (item.kind !== 'group') continue;
      const first = item.tabs[0];
      const index = first ? indexOfTab.get(first.tabId) : undefined;
      if (index !== undefined) byId.set(item.group.groupId, index);
    }
    return byId;
  }, [items, indexOfTab]);

  // KAN-166. Where the landing placeholder should point.
  //
  // A tab released inside a group's band joins that group, and the band's rect
  // includes the group's TITLE row -- while the landing index comes from row
  // midpoints, the first of which sits below that title. So in the strip at the
  // top of every group the index said "before the group" while the band said
  // "inside it", and the placeholder was drawn 34px above the band it had just
  // lit up.
  //
  // Both answers are right. The tab becomes the group's FIRST member, so it
  // lands in the first member's slot -- under the header, not above it. Stated
  // as an index rather than a distance because that is what it is: no pixels,
  // no header height, nothing to drift when row heights change.
  //
  // The DROP is untouched. This is the preview only; the reducer still receives
  // the raw index and produces the same arrangement.
  const landingIndexFor = useCallback(
    (toIndex: number, target: string | undefined) => {
      if (target === undefined) return toIndex;
      const first = groupFirstIndex.get(target);
      return first !== undefined && toIndex < first ? first : toIndex;
    },
    [groupFirstIndex]
  );

  const handleMoveGroup = useCallback(
    (itemId: string, toIndex: number) => {
      const groupId = groupIdOfItemId(itemId);
      // Only a group row has a handle, so a loose tab's id never arrives.
      if (groupId === undefined) return;
      dispatch(
        moveChromeGroupInternal({ tabGroupId, windowId, groupId, toIndex })
      );
    },
    [dispatch, tabGroupId, windowId]
  );

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    font-family: ${FONT_FAMILY};
    margin-bottom: 8px;
  `;

  const parentStyle = css`
    position: relative;
    display: flex;
    justify-content: space-between;
    /* No transition on the fill, and none on the mask below (KAN-100). The
       action strip is opaque and sits over the title, so it is invisible only
       while it is fully transparent or while this row has already arrived at
       the colour the strip is painted. Easing the fill guarantees a window
       where neither is true, and the row fills in two halves with a hard
       vertical edge between them -- measured here at 17 frames of 52. */
    &:hover {
      background-color: ${COLORS.HOVER_COLOR};
    }
  `;

  const parentLeftStyle = css`
    display: flex;
    align-items: center;
    flex-grow: 1;
    min-width: 0;
  `;

  const parentRightStyle = css`
    display: flex;
    position: absolute;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
    /* The mask lands in one frame with the row's fill; only the icons ease
       (KAN-100). They are glyphs over a background that is already uniform, so
       fading them cannot produce an edge -- which is what separates them from
       the mask they sit on. */
    /* No mask while editing: the field is beneath this block, so painting
       HOVER_COLOR here would drop a grey box onto a white input. */
    background-color: ${isParentHovered && !isEditing
      ? COLORS.HOVER_COLOR
      : 'transparent'};
    & > * {
      /* isEditing, because the confirm tick is not a hover affordance -- it is
         the editor's own control and has to be there whether or not the
         pointer is. Focus is in the INPUT while editing, which is outside this
         block, so neither isParentHovered nor :focus-within below ever fires
         and the tick was invisible unless the pointer happened to be over the
         row. The group editor avoids this by keying its reveal off the strip
         that CONTAINS its input. */
      opacity: ${isParentHovered || isEditing ? 1 : 0};
      transition: opacity 0.1s ease-out;
    }
    /* The keyboard's equivalent of the hover reveal (KAN-68). */
    &:focus-within {
      background-color: ${COLORS.HOVER_COLOR};
      & > * {
        opacity: 1;
      }
    }
    /* Left below the focus-within rule on purpose: during search these
       controls do not apply, and visibility:hidden removes them from the tab
       order as well as from view, so there is nothing inside to focus. */
    ${isSearchPanel && 'visibility: hidden;'}
  `;

  const childrenContainerStyle = css`
    padding-left: 70px;
  `;

  const childrenStyle = css`
    position: relative;
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    /* No transition on the fill, for the same reason as parentStyle above
       (KAN-100). */
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

  const childRightStyle = (tabId: string) => css`
    position: absolute;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
    /* Mask in one frame, icons ease -- see parentRightStyle (KAN-100). */
    background-color: ${hoveredTabId === tabId
      ? COLORS.HOVER_COLOR
      : 'transparent'};
    & > * {
      opacity: ${hoveredTabId === tabId ? 1 : 0};
      transition: opacity 0.1s ease-out;
    }
    /* The keyboard's equivalent of the hover reveal (KAN-68). Delete tab has
       no alternate path anywhere in the UI, so this row is the only way to
       reach it. */
    &:focus-within {
      background-color: ${COLORS.HOVER_COLOR};
      & > * {
        opacity: 1;
      }
    }
  `;

  // A plain string, not css``, because ClickableRow's `style` prop takes a
  // string. The two non-button branches below therefore have to wrap it as
  // css(parentLinkStyle): Emotion's `css` PROP rejects a bare string outright
  // ("Strings are not allowed as css prop values"), even though the `css`
  // FUNCTION accepts one. One declaration still serves all three branches.
  const parentLinkStyle = `
    text-decoration: none;
    color: inherit;
    display: flex;
    align-items: center;
    height: 100%;
    flex-grow: 1;
    min-width: 0;
    padding-right: 9px;
    ${!isSearchPanel ? 'cursor: pointer;' : ''}
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewTitle(e.target.value);
  };

  // `newTitle` is a DRAFT: nothing reads it unless `isEditing` is true, so it is
  // seeded at the moment editing starts rather than kept in step with the prop
  // by an effect. The effect this replaces re-seeded on every change to `title`,
  // so a rename arriving from another device -- a Firestore merge lands
  // replaceState(merged) with no user action -- overwrote what was being typed
  // here. KAN-51.
  const startEditing = () => {
    setNewTitle(title);
    setIsEditing(true);
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (title !== newTitle) {
      onUpdateWindowGroupTitle(newTitle);
    }
  };

  // What a group is called on screen. An untitled group has no name, so it
  // borrows the string that already named it for assistive tech -- present
  // and translated in all ten locales since KAN-11.
  const groupDisplayName = (group: chromeTabGroupData) =>
    group.title || t('Unnamed group');

  const renameGroupLabel = (group: chromeTabGroupData) =>
    t('Rename group') + ': ' + groupDisplayName(group);

  // WCAG 2.5.3, same shape as the tab rows: the accessible name contains the
  // visible title, and says what the control actually does now.
  const openGroupLabel = (group: chromeTabGroupData) =>
    t('Open group') + ': ' + groupDisplayName(group);

  const groupTitleLabel = (group: chromeTabGroupData) => (
    <NormalLabel
      value={groupDisplayName(group)}
      color={group.title ? COLORS.LABEL_L2_COLOR : COLORS.LABEL_L3_COLOR}
      // 0.85rem, not the 0.9rem the window title and tab titles share. At
      // 0.8rem this was the smallest content text in the pane and smaller than
      // the tabs the group contains, which reads as a caption rather than a
      // header. Matching 0.9 would instead make a group as prominent as the
      // window holding it. Compared in a browser before choosing.
      size="0.85rem"
      style={`padding-left: 4px;${group.title ? '' : ' font-style: italic;'}`}
    />
  );

  // The chrome query happens here rather than in the parent, matching
  // handleTabClick below, which already reaches for chrome.tabs directly.
  // A fresh uuid is minted for the stored tab, exactly as the window-level
  // add does -- the tab is a copy, not a reference to the live one.
  const addCurrentTabToGroup = async (group: chromeTabGroupData) => {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (!tab) return;
    dispatch(
      addCurrTabToChromeGroupInternal({
        tabGroupId,
        windowId,
        groupId: group.groupId,
        tabData: {
          tabId: uuidv4(),
          favicon: tab.favIconUrl || '',
          title: tab.title || '',
          url: resolveTabUrl(tab.url || ''),
        },
      })
    );
  };

  // Same DRAFT discipline as the window title above (KAN-51): seeded when
  // editing starts rather than kept in step by an effect, so a rename
  // arriving from another device cannot overwrite what is being typed.
  const startEditingGroup = (group: chromeTabGroupData) => {
    setGroupDraft(group.title);
    setEditingGroupId(group.groupId);
  };

  // Unlike the session and window renames, a blank is a legitimate result: it
  // clears the name and the group falls back to its placeholder. The reducer
  // owns that rule; this only declines to dispatch when nothing changed, so
  // opening and closing the editor is not a Firestore write.
  const commitGroupRename = (group: chromeTabGroupData) => {
    setEditingGroupId(null);
    if (group.title !== groupDraft) {
      dispatch(
        updateChromeTabGroupTitle({
          tabGroupId,
          windowId,
          groupId: group.groupId,
          editableTitle: groupDraft,
        })
      );
    }
  };

  // No stopPropagation and no isSearchPanel/isEditing guard any more: this is
  // only wired up on the branch where it is a real action, so it can no longer
  // be reached in a state where it does nothing, and the container it sits in
  // has no click handler of its own to bubble into.
  const handleWindowClick = () => {
    onWindowTitleClick();
  };

  const handleTabClick = (url: string) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTabIndex = tabs[0].index;
      chrome.tabs.create({
        url: resolveTabUrl(url),
        active: true,
        index: currentTabIndex + 1,
      });
    });
  };

  // Mirrors handleTabClick, for a whole group. Every other row in this pane
  // opens something on click -- the window title opens its window, a tab title
  // opens that tab -- and the group row was the only one that renamed instead,
  // which also left renaming with two entry points and opening with none.
  //
  // The index advances per tab. Creating them all at currentTabIndex + 1 would
  // reverse the group, because each insert pushes the previous one right.
  //
  // Tabs open ungrouped: re-forming the Chrome group needs the tabGroups
  // permission at click time and is deliberately left to its own ticket.
  const handleGroupClick = (run: GroupRun) => {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const current = tabs[0];
      if (!current) return;

      // Sequential, not Promise.all. Each create is given an explicit index,
      // and concurrent inserts would resolve those indexes against a list that
      // is still shifting -- the group would come out shuffled.
      const created: chrome.tabs.Tab[] = [];
      for (const [offset, tab] of run.tabs.entries()) {
        created.push(
          await chrome.tabs.create({
            url: resolveTabUrl(tab.url),
            // Nothing is created focused. Activating a tab DESTROYS the popup,
            // and everything below -- including the grouping -- is a
            // continuation of this handler that would simply never run. The
            // first version created the last tab active and the tabs opened
            // ungrouped in the real popup, while looking correct when driven
            // as a tab, which does not die.
            active: false,
            index: current.index + 1 + offset,
          })
        );
      }

      const tabIds = created
        .map((tab) => tab.id)
        .filter((id): id is number => id !== undefined);
      if (tabIds.length === 0) return;

      // Re-forms the saved group -- same name, same colour -- by reusing the
      // function restore already uses, rather than a second implementation of
      // the same thing. No permission check here: this row only renders when
      // hasTabGroupsPermission is true, and applyTabGroups feature-detects
      // chrome.tabGroups anyway, so a missing namespace leaves the tabs open
      // and ungrouped rather than failing the click.
      await applyTabGroups(
        current.windowId,
        [run.group],
        new Map([[run.group.groupId, tabIds]])
      );

      // Focus LAST, once the group exists. This is the step that kills the
      // popup, so nothing may depend on running after it.
      await chrome.tabs.update(tabIds[tabIds.length - 1], { active: true });
    });
  };

  function handleAccordionClick() {
    setWindowOpenState((state) => !state);
  }

  function handleKeyPressOnEditDone(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      handleBlur();
    }
  }

  // Hover is tracked by tabId, not by position (KAN-127). A position-keyed
  // flag points at whichever tab has since moved into that slot, so anything
  // that reorders the list -- a sync adopting the other device's window, or a
  // drag -- reveals the wrong row's actions. It also removes the cross-run
  // index arithmetic this used to need, since a run's local index and the
  // window-wide one no longer have to be reconciled.
  function renderTab({ tabId, favicon, title, url }: tabData) {
    return (
      <div
        key={tabId}
        css={childrenStyle}
        onMouseEnter={() => setHoveredTabId(tabId)}
        onMouseLeave={() => setHoveredTabId(null)}
      >
        {/* The name reuses the string the tooltip already carried, so no new
            hardcoded English enters the app -- the 25 untranslated
            aria-labels of KAN-65 stay one clean sweep. The favicon Icon
            inside is presentational and aria-hidden, so it does not leak
            into the name. */}
        <ClickableRow
          ariaLabel={t('Open in new tab') + ': ' + title}
          onClick={() => handleTabClick(url)}
          style={childLeftStyle}
        >
          <Icon
            faviconUrl={resolveFaviconUrl(favicon, url)}
            type="globe"
            style={`&:hover {background-color: unset;}`}
          />
          <div css={windowChildLinkStyle}>
            <NormalLabel
              value={title}
              color={COLORS.TEXT_COLOR}
              size="0.9rem"
              style="padding-left: 4px; height: 100%; max-width: 100%;"
            />
          </div>
        </ClickableRow>
        {/* data-row-actions is the stylesheet's hook for hiding this strip
            during a drag (KAN-135). The reveal above is an emotion class keyed
            on React state, which App.css cannot name. */}
        <div data-row-actions css={childRightStyle(tabId)}>
          <Icon
            tooltipText={t('Delete tab')}
            ariaLabel={t('Delete tab')}
            type="delete"
            onClick={(e) => {
              e.stopPropagation();
              dispatch(deleteTab({ tabGroupId, windowId, tabId }));
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div css={containerStyle}>
      {/* The grab handle for the WINDOW drag (KAN-129), read by the area
          above this component through its handleSelector. It has to be the
          header alone: the draggable node wraps this row AND the tab list
          below it, so a handle covering the whole block would start a window
          drag from every tab drag. Marked with an attribute rather than
          plumbed down as a prop, matching data-band-id beside it -- and the
          area checks the handle it finds is CONTAINED by the row, so this
          cannot be satisfied by anything outside the window it belongs to. */}
      <div
        data-window-drag-handle
        css={parentStyle}
        onMouseEnter={() => setIsParentHovered(true)}
        onMouseLeave={() => setIsParentHovered(false)}
      >
        <div css={parentLeftStyle}>
          <Icon
            tooltipText={windowOpenState ? t('Collapse') : t('Expand')}
            ariaLabel={windowOpenState ? t('Collapse') : t('Expand')}
            type={windowOpenState ? 'expand_less' : 'expand_more'}
            onClick={handleAccordionClick}
          />
          <Icon type="web_asset" style={NON_INTERACTIVE_ICON_STYLE} />
          {/* Three shapes, because only one of them is a control (KAN-64).
              This used to be a single role-less div carrying tabIndex={0} and
              onClick -- focusable, exposed as `generic` where naming is
              prohibited, and activating via `handleWindowClick(e as any)`.

              Editing: an <input> may not live inside a <button>; clicking it
              would activate the button and it could not hold focus.

              Searching: handleWindowClick is a no-op while isSearchPanel, so
              rendering a button here would be focusable and inert -- exactly
              the KAN-62 defect this codebase just fixed. It renders as static
              text instead.

              Otherwise: a real button. */}
          {isEditing && !isSearchPanel ? (
            // padding-right: 0 overrides parentLinkStyle's 9px, which exists
            // to keep the RESTING title clear of the action icons. While
            // editing there is no title to keep clear, and the reserved gap
            // left the field stopping 9px short of the row's edge.
            <div css={css(parentLinkStyle + 'padding-right: 0;')}>
              <input
                value={newTitle}
                onBlur={handleBlur}
                onChange={handleChange}
                onKeyDown={(e) => handleKeyPressOnEditDone(e)}
                autoFocus
                css={css`
                  color: ${COLORS.TEXT_COLOR};
                  background-color: ${COLORS.PRIMARY_COLOR};
                  border: 1px solid ${COLORS.BORDER_COLOR};
                  display: flex;
                  align-items: center;
                  font-family: ${FONT_FAMILY};
                  font-size: 0.9rem;
                  padding-left: 8px;
                  height: 100%;
                  width: 100%;
                  min-width: 0;
                  &:focus {
                    outline: none;
                  }
                `}
              />
            </div>
          ) : isSearchPanel ? (
            <div css={css(parentLinkStyle)}>
              <NormalLabel
                value={title}
                color={COLORS.TEXT_COLOR}
                size="0.9rem"
                style="padding-left: 8px; height: 100%; max-width: 100%;"
              />
            </div>
          ) : (
            <ClickableRow
              ariaLabel={title}
              tooltipText={t('Open in new window')}
              onClick={handleWindowClick}
              style={parentLinkStyle}
            >
              <NormalLabel
                value={title}
                color={COLORS.TEXT_COLOR}
                size="0.9rem"
                style="padding-left: 8px; cursor: pointer; height: 100%; max-width: 100%;"
              />
            </ClickableRow>
          )}
        </div>
        <div data-row-actions css={parentRightStyle}>
          {isEditing && !isSearchPanel ? (
            // Same shape as the session tick: the wrapper carries the
            // onMouseDown that Icon does not expose, preventDefault keeps focus
            // in the input so onClick is the single commit path, and the
            // wrapper itself is what stops the post-commit click retargeting
            // onto the pencil that replaces this tick.
            <span onMouseDown={(e) => e.preventDefault()}>
              <Icon
                tooltipText={t('Save changes')}
                ariaLabel={t('Save changes')}
                type="done"
                onClick={(e) => {
                  e.stopPropagation();
                  handleBlur();
                }}
              />
            </span>
          ) : (
            <Icon
              tooltipText={t('Rename window group')}
              ariaLabel={t('Rename window group')}
              type="edit"
              onClick={(e) => {
                e.stopPropagation();
                startEditing();
              }}
            />
          )}

          {!isEditing && !isSearchPanel && (
            <Icon
              tooltipText={t('Add current tab')}
              ariaLabel={t('Add current tab')}
              type="add"
              onClick={(e) => {
                e.stopPropagation();
                onAddCurrTabToWindowClick(e);
              }}
            />
          )}
          {!isEditing && !isSearchPanel && (
            <Icon
              tooltipText={t('Delete window group')}
              ariaLabel={t('Delete window group')}
              type="delete"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteClick(e);
              }}
            />
          )}
        </div>
      </div>
      {windowOpenState && (
        // data-window-tabs is the hook App.css uses to fold every window shut
        // while a WINDOW is being dragged (KAN-153). Visual only -- this
        // component's own open/closed state is never touched, which is what
        // makes "and it comes back how it was" require no bookkeeping at all.
        <div css={childrenContainerStyle} data-window-tabs>
          <RowDragArea
            scope="tabs"
            rowIds={tabIds}
            onMove={handleMove}
            dragKind="tab"
            resolveDrop={bandAt}
            onDropTargetChange={markDropTargetBand}
            landingIndexFor={landingIndexFor}
            // The mode, not the box's contents -- see KAN-140 on
            // TabGroupEntryContainer for why this is not isFilteredView.
            disabled={isSearchPanel}
          >
            {/* KAN-160. The window's items -- loose tabs and whole groups --
                as a second list inside the tab list. Only a group's title
                row is a handle, so a press on a tab reaches this list's
                begin, finds no handle, and is left to the tab list. Tab rows
                name scope="tabs" to join the tab list THROUGH this one.

                No clampDropToEnds: outside this window's rows means out of
                the window, which must be refused. restoreScrollIfNoDrop,
                because compressing the held group can shrink the list and
                clamp the scroll. */}
            <RowDragArea
              scope="items"
              rowIds={itemIds}
              onMove={handleMoveGroup}
              dragKind="group"
              handleSelector="[data-group-drag-handle]"
              restoreScrollIfNoDrop
              disabled={isSearchPanel}
            >
              {items.map((item, itemIndex) =>
                item.kind === 'tab' ? (
                  <DraggableRow
                    key={itemIdOf(item)}
                    scope="items"
                    rowId={itemIdOf(item)}
                    index={itemIndex}
                  >
                    <DraggableRow
                      scope="tabs"
                      rowId={item.tab.tabId}
                      index={indexOfTab.get(item.tab.tabId) ?? 0}
                    >
                      {renderTab(item.tab)}
                    </DraggableRow>
                  </DraggableRow>
                ) : (
                  <DraggableRow
                    key={itemIdOf(item)}
                    scope="items"
                    rowId={itemIdOf(item)}
                    index={itemIndex}
                  >
                    <div
                      data-band-id={item.group.groupId}
                      role="group"
                      aria-label={item.group.title || t('Unnamed group')}
                      css={css`
                        display: flex;
                        align-items: stretch;
                        margin: 2px 0;

                        /* KAN-164: a tab released here joins this group.
                           Outline rather than border, so marking a band
                           reflows nothing.

                           Drawn OUTSIDE the band (positive offset), which is
                           what makes it legible. Inset, its left segment would
                           cross the group's colour strip -- Chrome's fixed
                           pastels -- where the app's text colour measures
                           1.05:1 against cyan in the dark themes, i.e. gone.
                           Outside, its backdrop is the page in every case.

                           The colour is named once, in
                           dropTargetRingColor, so the 3:1 floor it has to
                           clear is asserted against the same value this
                           draws rather than a copy of it.

                           No backticks in here: this comment sits inside an
                           emotion template literal, and one would end it. */
                        /* KAN-164: a tab released here joins this group, so
                           the group answers in its own colour. A wash rather
                           than a ring, because fills are what every other
                           state in this pane is made of. The strip's widen
                           (GroupColorPicker) is the part that carries the
                           meaning without relying on hue. */
                        &[data-drop-target] {
                          background-color: color-mix(
                            in srgb,
                            var(--band-color, transparent) 18%,
                            transparent
                          );
                          border-radius: 4px;
                        }
                      `}
                    >
                      <GroupFrameFollower
                        memberIndices={item.tabs.map(
                          (member) => indexOfTab.get(member.tabId) ?? -1
                        )}
                      />
                      {/* The colour is Chrome's own group identity, not app chrome
                    (BINDING CONSTRAINT 1) -- TAB_GROUP_COLOR_HEX is a fixed
                    map, not routed through useThemeColors, so it reads the
                    same in every theme as it does in the browser.

                    This REPLACES the older rule that the band is aria-hidden
                    and decorative (BINDING CONSTRAINT 3). That held while it
                    only painted; it now opens the colour picker, and a control
                    must be named. Its name says what it CHANGES rather than
                    repeating the group name the role="group" boundary above
                    already announces. The band stays a sibling of the header
                    strip so it spans the whole group, as Chrome's does. */}
                      <GroupColorPicker
                        color={item.group.color}
                        decorative={isSearchPanel}
                        ariaLabel={
                          t('Change group color') +
                          ': ' +
                          groupDisplayName(item.group)
                        }
                        onSelect={(color) =>
                          dispatch(
                            updateChromeTabGroupColor({
                              tabGroupId,
                              windowId,
                              groupId: item.group.groupId,
                              color,
                            })
                          )
                        }
                      />
                      <div
                        css={css`
                          flex: 1;
                          min-width: 0;
                        `}
                      >
                        {/* The group's header strip.

                      This REPLACES the older rule that an untitled group
                      renders as the band alone (BINDING CONSTRAINT 2). That
                      held while the title was inert text, but a rename
                      control has to live somewhere, and the only unclaimed
                      space is a strip of exactly this height -- the first tab
                      row's right edge is already taken by its delete Icon.
                      Reserving the strip and leaving it blank costs the same
                      22px while explaining nothing, so an untitled group
                      fills it with a placeholder instead. Measured before
                      choosing; see chromeGroupRename.test.tsx.

                      The placeholder is italic and one label tier dimmer than
                      a real name so it does not read as content -- the group
                      is not called "Unnamed group", it has no name. */}
                        {/* The group drag's handle (KAN-160). The colour bar
                        is its sibling, not inside it, so the picker keeps its
                        press. */}
                        <div
                          data-group-drag-handle
                          css={css`
                            position: relative;
                            display: flex;
                            align-items: center;
                            /* KAN-165: the frame travels with its tabs, so it
                               has to glide like they do. Same duration as the
                               rows stepping aside in RowDragArea. */
                            transition: transform 0.18s ease;
                            /* 32px, the height the window row and every tab row
                         already stand at -- measured, not guessed. At 22px the
                         hover fill read as a short band wedged between
                         full-height ones. It is also exactly the action icons'
                         height, so they now fit the row rather than
                         overflowing a shorter one. */
                            min-height: 32px;
                            /* Fills like the window row above and the tab rows
                         below, which both paint HOVER_COLOR under the pointer.
                         Without it this row revealed its actions while giving
                         no sign of being hovered at all.

                         Both triggers, because the actions appear on both:
                         reveal and fill are one visual state with one trigger
                         (KAN-100), and filling on only one is how they came
                         apart last time.

                         No transition on the fill, also KAN-100 -- easing it
                         lets the row reach the colour in two halves with a
                         visible edge between them. */
                            &:hover,
                            &:focus-within {
                              background-color: ${COLORS.HOVER_COLOR};
                            }
                            &:hover .group-rename-reveal,
                            &:focus-within .group-rename-reveal {
                              opacity: 1;
                            }
                          `}
                        >
                          {editingGroupId === item.group.groupId &&
                          !isSearchPanel ? (
                            <input
                              value={groupDraft}
                              aria-label={renameGroupLabel(item.group)}
                              onBlur={() => commitGroupRename(item.group)}
                              onChange={(e) => setGroupDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter')
                                  commitGroupRename(item.group);
                              }}
                              autoFocus
                              css={css`
                                color: ${COLORS.TEXT_COLOR};
                                background-color: ${COLORS.PRIMARY_COLOR};
                                border: 1px solid ${COLORS.BORDER_COLOR};
                                /* Same four declarations the window title editor
                             carries. Without height and padding the field
                             collapsed to the intrinsic height of its text and
                             sat 2px short of its own row, with the browser's
                             default 2px padding rather than a chosen one --
                             which read as a thinner, tighter box than the
                             editor one level above it. */
                                display: flex;
                                align-items: center;
                                font-family: ${FONT_FAMILY};
                                /* Matches the label this replaces, or the text
                             visibly jumps size on entering edit mode. */
                                font-size: 0.85rem;
                                padding-left: 8px;
                                /* align-self, NOT height: 100%. The strip is a flex
                             container with align-items: center and only a
                             min-height, so it has no definite height for a
                             percentage to resolve against and the child is not
                             stretched -- height: 100% computed, rendered
                             nothing, and left the field 2px short of its row.
                             Stretching the item is what actually fills it. */
                                align-self: stretch;
                                width: 100%;
                                min-width: 0;
                                &:focus {
                                  outline: none;
                                }
                              `}
                            />
                          ) : isSearchPanel ? (
                            // A control that cannot act must not be focusable and
                            // inert (KAN-62), so searching gets static text.
                            groupTitleLabel(item.group)
                          ) : (
                            // WCAG 2.5.3, same shape as KAN-77: the accessible name
                            // CONTAINS the visible one, so "click Research" works.
                            // padding-right reserves the action block's width so a
                            // long title ellipsizes instead of rendering UNDER the
                            // icons. The block is absolutely positioned -- kept that
                            // way deliberately, so the title does not reflow and
                            // jump when the icons appear on hover -- which means
                            // layout gives it no room unless it is reserved here.
                            // Measured at 100/125/150% zoom before and after.
                            <ClickableRow
                              ariaLabel={openGroupLabel(item.group)}
                              tooltipText={t('Open group')}
                              onClick={() => handleGroupClick(item)}
                              // align-self, because the strip centres its children
                              // -- without it the clickable is only as tall as its
                              // text and the row has 8px of dead zone above and
                              // below, while the hover fill paints the full 32px.
                              // The tab rows get this from their parent's
                              // align-items: stretch; this strip has to ask.
                              style="display: flex; align-items: center; align-self: stretch; min-width: 0; width: 100%; padding-right: 100px; box-sizing: border-box;"
                            >
                              {groupTitleLabel(item.group)}
                            </ClickableRow>
                          )}
                          {editingGroupId === item.group.groupId &&
                            !isSearchPanel && (
                              // Same shape as the other two ticks: the wrapper stops
                              // the post-commit click retargeting onto the pencil, and
                              // preventDefault keeps focus in the input so onClick is
                              // the single commit path.
                              <span
                                data-row-actions
                                className="group-rename-reveal"
                                css={css`
                                  position: absolute;
                                  top: 50%;
                                  right: 0;
                                  transform: translateY(-50%);
                                  opacity: 1;
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
                                    commitGroupRename(item.group);
                                  }}
                                />
                              </span>
                            )}
                          {editingGroupId !== item.group.groupId &&
                            !isSearchPanel && (
                              // data-row-actions: hidden while any drag is in flight
                              // (KAN-135). The held group's title row stays hovered
                              // for the whole drag.
                              <div
                                data-row-actions
                                className="group-rename-reveal"
                                css={css`
                                  position: absolute;
                                  top: 50%;
                                  right: 0;
                                  transform: translateY(-50%);
                                  opacity: 0;
                                  transition: opacity 0.1s ease-out;
                                  display: flex;
                                  align-items: center;
                                  /* Load-bearing, and only visible in a real browser.
                             translateY above makes this element a STACKING
                             CONTEXT, which traps the overflow menu's own
                             z-index inside it -- the menu then painted behind
                             the tab rows below, which are later siblings with
                             position: relative. Lifting the context itself is
                             what puts the menu over them. */
                                  /* The row owning an open menu outranks its
                             siblings; see openMenuGroupId above. */
                                  z-index: ${openMenuGroupId ===
                                  item.group.groupId
                                    ? 3
                                    : 1};
                                `}
                              >
                                <Icon
                                  tooltipText={t('Rename group')}
                                  ariaLabel={t('Rename group')}
                                  type="edit"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startEditingGroup(item.group);
                                  }}
                                />
                                <Icon
                                  tooltipText={t('Add current tab to group')}
                                  ariaLabel={t('Add current tab to group')}
                                  type="add"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    addCurrentTabToGroup(item.group);
                                  }}
                                />
                                {/* Ungroup and delete live behind the overflow rather
                            than as two more icons: four 32px icons overlap a
                            long title from 125% zoom, and "Ungroup" is not a
                            concept named anywhere else in this UI, so it needs
                            a word rather than a glyph. */}
                                <OverflowMenu
                                  ariaLabel={t('More actions')}
                                  // Guarded on identity rather than assigning blindly:
                                  // opening a second menu closes the first, and the
                                  // close can land after the open, which would
                                  // otherwise clear the row that just opened.
                                  onOpenChange={(open) =>
                                    setOpenMenuGroupId((prev) =>
                                      open
                                        ? item.group.groupId
                                        : prev === item.group.groupId
                                          ? null
                                          : prev
                                    )
                                  }
                                  items={[
                                    {
                                      key: 'ungroup',
                                      label: t('Ungroup'),
                                      icon: 'label_off',
                                      onSelect: () =>
                                        dispatch(
                                          ungroupChromeTabGroup({
                                            tabGroupId,
                                            windowId,
                                            groupId: item.group.groupId,
                                          })
                                        ),
                                    },
                                    {
                                      key: 'delete',
                                      label: t('Delete group'),
                                      icon: 'delete',
                                      danger: true,
                                      onSelect: () =>
                                        dispatch(
                                          deleteChromeTabGroupInternal({
                                            tabGroupId,
                                            windowId,
                                            groupId: item.group.groupId,
                                          })
                                        ),
                                    },
                                  ]}
                                />
                              </div>
                            )}
                        </div>
                        <div data-group-tabs>
                          {item.tabs.map((tabItem) => (
                            <DraggableRow
                              key={tabItem.tabId}
                              scope="tabs"
                              rowId={tabItem.tabId}
                              index={indexOfTab.get(tabItem.tabId) ?? 0}
                            >
                              {renderTab(tabItem)}
                            </DraggableRow>
                          ))}
                        </div>
                      </div>
                    </div>
                  </DraggableRow>
                )
              )}
            </RowDragArea>
          </RowDragArea>
        </div>
      )}
    </div>
  );
};

export default WindowEntryContainer;
