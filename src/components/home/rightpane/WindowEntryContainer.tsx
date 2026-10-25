import React, { useId, useMemo, useRef, useState } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import ChevronGlyph from '../../common/ChevronGlyph';
import ClickableRow from '../../common/ClickableRow';
import {
  focusRingOutsideCss,
  focusRingOverTickCss,
  whileKeyNav,
} from '../../common/focusRing';
import { renameOnClickStyle } from '../../common/renameOnClickStyle';
import { DropBoxLabel } from '../../common/dropBox';
import { dropBoxStyle } from '../../common/dropBoxStyle';
import Icon from '../../common/Icon';
import { RowMarkIcon, RowMarkSlot } from '../../common/RowMarks';
import OverflowMenu from '../../common/OverflowMenu';
import type { OverflowMenuItem } from '../../common/MenuPanel';
import { useRowContextMenu } from '../../common/rowMenu/useRowContextMenu';
import GroupColorPicker from '../../common/GroupColorPicker';
import { NormalLabel } from '../../common/Label';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useSavedSearch } from '../../../hooks/useSavedSearch';
import { useIsOpenBlockedByTour } from '../../../hooks/useIsOpenBlockedByTour';
import { AppDispatch, RootState } from '../../../redux/store';
import {
  resolveTabUrl,
  resolveFaviconUrl,
  formatTabCount,
} from '../../../utils/functions/local';
import { RowTag } from '../../common/RowTag';
import {
  HIDE_TAGS_UNDER_STRIP,
  markTagsUnderStrip,
} from '../../common/tagsUnderStrip';
import { visuallyHiddenStyle } from '../../../styles/visuallyHidden';
import { NON_INTERACTIVE_ICON_STYLE } from '../../../utils/constants/common';
import { copyLinkItem } from '../../common/rowMenu/copyLinkItem';
import { copyAllLinksItem } from '../../common/rowMenu/copyAllLinksItem';
import { copyScopeLinks } from '../../../utils/functions/copySessionLinks';
import {
  groupLinkScope,
  windowLinkScope,
} from '../../../utils/functions/sessionExportHtml';
import {
  deleteTab,
  tabData,
  updateChromeTabGroupTitle,
  addCurrTabToChromeGroupInternal,
  ungroupChromeTabGroup,
  deleteChromeTabGroup,
  updateChromeTabGroupColor,
  removeDuplicateTabs,
  sortGroupTabsBySite,
  sortTabsBySite,
  sortWindowGroupsByName,
} from '../../../redux/slices/tabContainerDataStateSlice';
import {
  isSavedGroupSortedBySite,
  isSavedWindowSortedBySite,
} from '../../../utils/functions/sortBySite';
import { isSavedWindowGroupsSortedByName } from '../../../utils/functions/sortGroupsByName';
import { countDuplicateTabs } from '../../../utils/functions/duplicateTabs';
import {
  collapsedWindowIdsOf,
  toggleWindowCollapse,
} from '../../../redux/slices/globalStateSlice';
import { useTranslation } from 'react-i18next';
import {
  partitionTabsIntoItems,
  itemIdOf,
} from '../../../utils/functions/tabGroups';
import type {
  chromeTabGroupData,
  GroupRun,
} from '../../../utils/functions/tabGroups';
import { applyTabGroups } from '../../../utils/functions/windows';
import { savedSplitPartners } from '../../../utils/functions/splitPartners';
import { isTabKeeperPage, toStoredTab } from '../../../utils/functions/capture';
import { isTabView } from '../../../utils/functions/viewMode';

import { DraggableRow } from './rowDrag/RowDragArea';
import { DragHandle, DragHandleSwap } from './rowDrag/DragHandle';
import { markRowContainer } from './rowDrag/dropRules';
import { useDragState } from './rowDrag/dragContext';
import { GroupFrameFollower } from './rowDrag/GroupFrameFollower';
import { ADJACENT_GROUP_GAP_PX, BAND_MARGIN_PX } from './bandSpacing';
import { useIsSpringOpen } from '../../../redux/springOpenWindows';
import { springSweepStyle } from '../../common/springOpen';
import { NEW_LAST_WINDOW } from './newWindowTarget';
import RowOpenButton from './RowOpenButton';
import { CONTROL, DURATION, RADIUS, TYPE } from '../../../styles/scale';
import { placeholderStyle } from '../../../styles/placeholder';
import { windowLabel } from '../../../utils/functions/windowLabel';
import { renameKeyDown } from '../../../utils/functions/renameKeyDown';
import { useFocusOnRemount } from '../../../hooks/useFocusOnRemount';

/**
 * The Chrome group title, and the editor that replaces it (KAN-205).
 *
 * The one value in the popup deliberately BETWEEN two steps of the type scale,
 * and the reason is kept rather than inherited: the window title and the tab
 * titles are both TYPE.BODY, so a group at BODY reads as prominent as the
 * window holding it, and at TYPE.SECONDARY it is smaller than the tabs it
 * contains and reads as a caption. Compared in a browser before choosing.
 *
 * One constant rather than the same literal twice, because the label and its
 * editor drifting apart is exactly what chromeGroupRename's "the editor matches
 * the label it replaces" test caught the moment they did.
 */
const GROUP_TITLE_SIZE = '0.85rem';

interface WindowEntryContainerProps {
  title: string;
  // Its place in the session, as TabGroupDetailsContainer numbers it (D1).
  number: number;
  tabs: tabData[];
  chromeTabGroups?: chromeTabGroupData[];
  tabGroupId: string;
  windowId: string;
  onOpenWindow: () => void;
  onUpdateWindowGroupTitle: (newTitle: string) => void;
  onAddCurrTabToWindowClick: () => void;
  onDeleteClick: () => void;
}

const WindowEntryContainer: React.FC<WindowEntryContainerProps> = ({
  title,
  number,
  tabs,
  chromeTabGroups,
  tabGroupId,
  windowId,
  onOpenWindow,
  onUpdateWindowGroupTitle,
  onAddCurrTabToWindowClick,
  onDeleteClick,
}) => {
  // How far this window's block moves to make room for a row landing in
  // another one (KAN-184). BOTH lists are asked because either can carry a row
  // across windows -- a tab in the `tabs` list, a whole group in `items` -- and
  // only one of them is ever dragging.
  const tabDrag = useDragState('tabs');
  const itemDrag = useDragState('items');
  const windowShift =
    (tabDrag?.windowShifts[windowId] ?? 0) ||
    (itemDrag?.windowShifts[windowId] ?? 0);

  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t, i18n } = useTranslation();
  const label = windowLabel(title, number, t('Window'));
  // A label the user did not choose is muted.
  const labelColor = label.named ? COLORS.TEXT_COLOR : COLORS.LABEL_L2_COLOR;

  const dispatch: AppDispatch = useDispatch();

  // KAN-206. Whether this window is folded shut, read from the store rather
  // than held here. It moved because the session header's "collapse all" has to
  // reach it, and that control is this component's SIBLING -- both hang off
  // RightPane -- so there was no prop path to it.
  //
  // DERIVED, not state, which is why there is no setter beside it: the truth is
  // one entry in globalState and this is a reading of it. The old name
  // `windowOpenState` described a thing this component owned, and it no longer
  // owns it.
  //
  // The selector returns a boolean deliberately. collapsedWindowIdsOf answers
  // with a fresh [] for a session that owns no set, and returning that array
  // straight from useSelector would be a new reference on every render.
  const isOpenInStore = useSelector(
    (state: RootState) =>
      !collapsedWindowIdsOf(
        state.globalState.collapsedWindows,
        tabGroupId
      ).includes(windowId)
  );
  // KAN-379. A window a drag opened is drawn open, with the stored fold intact.
  const isSpringOpened = useIsSpringOpen(windowId);
  const isWindowOpen = isOpenInStore || isSpringOpened;
  // KAN-413. Opens on the tour's own sample wait for it; drag, rename and fold do not.
  const isOpenBlocked = useIsOpenBlockedByTour(tabGroupId);
  const openBlockedBecause = isOpenBlocked
    ? t('Open works after the tour')
    : null;
  const [newTitle, setNewTitle] = useState(title);
  const [isEditing, setIsEditing] = useState(false);
  // Set by Esc, so a blur dispatched before the editor unmounts cannot commit (D13).
  const renameCancelled = useRef(false);
  const [isParentHovered, setIsParentHovered] = useState(false);
  // Which Chrome group is being renamed, by its capture-time uuid -- not a
  // boolean, because one window can hold several groups and a boolean would
  // put every one of them into edit mode at once.
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState('');
  // The group field's Esc, read by its blur as renameCancelled is (D13).
  const groupRenameCancelled = useRef(false);
  // Enter, Esc and the tick end a window or group rename on its title button (KAN-400); a blur leaves focus where it went.
  const titleFocus = useFocusOnRemount();
  // Which group's overflow menu is open, so its action strip can outrank its
  // siblings. Every strip is a stacking context of its own (transform), so
  // equal z-indexes leave DOM order deciding -- and a LOWER group's strip then
  // painted over an open menu belonging to the group above it.
  const [openMenuGroupId, setOpenMenuGroupId] = useState<string | null>(null);
  // The same, for the window's own menu (KAN-616).
  const [isWindowMenuOpen, setIsWindowMenuOpen] = useState(false);
  // KAN-616. Counted as the reducer counts, so the label promises what Remove does.
  const here = { windows: [{ windowId, tabs }] };
  const windowDuplicates = countDuplicateTabs(here, { windowId });
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);

  // KAN-131. `tabs` here is whatever the pane handed down, and under a live
  // search that is a SUBSET of the stored window -- filterTabGroups narrows a
  // window's tabs, not just which windows are shown. A drag reports an index
  // into the rows on screen and moveTabInternal applies it to the stored
  // array, so in a narrowed list the tab lands somewhere the user never
  // pointed at, silently, and the session is dirtied for a cloud write.
  // The gate is searching (KAN-385).
  const { isSearching } = useSavedSearch();

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

  // The window's top-level rows as drawn: each loose tab, and each group as
  // one item (KAN-160). useGroupDrop builds this window's stretch of the
  // pane-wide items list with the same function, and moveChromeGroupInternal
  // rebuilds it with the same function again (KAN-131: an index is only valid
  // in the list that produced it).
  const items = useMemo(
    () =>
      partitionTabsIntoItems(
        tabs,
        hasTabGroupsPermission ? chromeTabGroups : undefined
      ),
    [tabs, chromeTabGroups, hasTabGroupsPermission]
  );
  // KAN-361/366. The trailing block (NEW_LAST_WINDOW); described where it is styled.
  const isTrailingBlock = windowId === NEW_LAST_WINDOW;

  // What a group is called on screen. An untitled group has no name, so it
  // borrows the string that already named it for assistive tech -- present
  // and translated in all ten locales since KAN-11.
  const groupDisplayName = (group: chromeTabGroupData) =>
    group.title || t('Unnamed group');

  // WCAG 2.5.3, same shape as the tab rows: the accessible name contains the
  // visible title, and says what the control actually does now.
  const groupDuplicateItem = (groupId: string): OverflowMenuItem[] => {
    const count = countDuplicateTabs(here, { windowId, groupId });
    return count > 0
      ? [
          {
            key: 'duplicates',
            label: t('RemoveDuplicateTabs', { count }),
            icon: 'stack_off',
            onSelect: () =>
              void dispatch(
                removeDuplicateTabs({
                  tabGroupId,
                  within: { windowId, groupId },
                })
              ),
          },
        ]
      : [];
  };

  // KAN-708. The window's items: the one source for its ⋮ and its right-click menu.
  const savedWindowMenuItems: OverflowMenuItem[] = [
    // KAN-783. First, as on a session: the one item that changes nothing.
    copyAllLinksItem(
      () =>
        copyScopeLinks(
          windowLinkScope(label.text, { tabs, chromeTabGroups }),
          t
        ),
      { t, dispatch }
    ),
    // Only while sorting would change the order.
    ...(isSavedWindowSortedBySite({ tabs })
      ? []
      : [
          {
            key: 'sortBySite',
            label: t('Sort tabs by site'),
            icon: 'sort' as const,
            onSelect: () =>
              void dispatch(sortTabsBySite({ tabGroupId, windowId })),
          },
        ]),
    // KAN-746 Part 2. Only while groups are drawn and two or more are out of name order.
    ...(hasTabGroupsPermission &&
    !isSavedWindowGroupsSortedByName({ tabs, chromeTabGroups }, i18n.language)
      ? [
          {
            key: 'sortGroupsByName',
            label: t('Sort groups by name'),
            icon: 'sort' as const,
            onSelect: () =>
              void dispatch(
                sortWindowGroupsByName({
                  tabGroupId,
                  windowId,
                  locale: i18n.language,
                })
              ),
          },
        ]
      : []),
    // Only while there is one to remove, as in the session menu.
    ...(windowDuplicates > 0
      ? [
          {
            key: 'duplicates',
            label: t('RemoveDuplicateTabs', { count: windowDuplicates }),
            icon: 'stack_off' as const,
            onSelect: () =>
              void dispatch(
                removeDuplicateTabs({ tabGroupId, within: { windowId } })
              ),
          },
        ]
      : []),
    {
      key: 'delete',
      label: t('Delete window'),
      icon: 'delete',
      danger: true,
      onSelect: onDeleteClick,
    },
  ];

  // KAN-708. A group's items: the one source for its ⋮ and its right-click menu.
  const savedGroupMenuItems = (groupId: string): OverflowMenuItem[] => [
    // KAN-783. First, as on the window.
    copyAllLinksItem(
      () => {
        const group = chromeTabGroups?.find((g) => g.groupId === groupId);
        return copyScopeLinks(
          groupLinkScope(
            group ? groupDisplayName(group) : t('Unnamed group'),
            { tabs },
            groupId
          ),
          t
        );
      },
      { t, dispatch }
    ),
    // KAN-746. First, as on the window, and only while sorting would change the group's order.
    ...(isSavedGroupSortedBySite({ tabs }, groupId)
      ? []
      : [
          {
            key: 'sortBySite',
            label: t('Sort tabs by site'),
            icon: 'sort' as const,
            onSelect: () =>
              void dispatch(
                sortGroupTabsBySite({ tabGroupId, windowId, groupId })
              ),
          },
        ]),
    {
      key: 'ungroup',
      label: t('Ungroup'),
      icon: 'label_off',
      onSelect: () =>
        dispatch(ungroupChromeTabGroup({ tabGroupId, windowId, groupId })),
    },
    // KAN-616 (2A). Lighter than Delete group, heavier than Ungroup.
    ...groupDuplicateItem(groupId),
    {
      key: 'delete',
      label: t('Delete tab group'),
      icon: 'delete',
      danger: true,
      onSelect: () =>
        dispatch(deleteChromeTabGroup({ tabGroupId, windowId, groupId })),
    },
  ];

  // KAN-793. A right-click leads with the strip's Open and Add current tab, and the title's Rename; the ⋮ beside them does not.
  // Lambdas: the handlers are declared further down.
  // No tour check: a running tour keeps every right-click menu shut.
  const windowRowButtons: OverflowMenuItem[] = [
    {
      key: 'open',
      actionRowLabel: t('Open'),
      label: t('Open in new window'),
      icon: 'reopen_window',
      onSelect: () => onOpenWindow(),
    },
    ...(isTabView()
      ? []
      : [
          {
            key: 'addTab',
            actionRowLabel: t('Add tab'),
            label: t('Add current tab'),
            icon: 'add' as const,
            onSelect: () => onAddCurrTabToWindowClick(),
          },
        ]),
    {
      key: 'rename',
      actionRowLabel: t('Rename'),
      label: t('Rename window'),
      icon: 'edit',
      onSelect: () => startEditing(),
    },
  ];
  const groupRowButtons = (run: GroupRun): OverflowMenuItem[] => [
    {
      key: 'open',
      actionRowLabel: t('Open'),
      label: t('Open group'),
      icon: 'reopen_window',
      onSelect: () => openGroup(run),
    },
    ...(isTabView()
      ? []
      : [
          {
            key: 'addTab',
            actionRowLabel: t('Add tab'),
            label: t('Add current tab to group'),
            icon: 'add' as const,
            onSelect: () => void addCurrentTabToGroup(run.group),
          },
        ]),
    {
      key: 'rename',
      actionRowLabel: t('Rename'),
      label: t('Rename group'),
      icon: 'edit',
      onSelect: () => startEditingGroup(run.group),
    },
  ];

  // KAN-708. A row's menu exists exactly when its ⋮ shows.
  const windowMenu = useRowContextMenu({
    kind: 'savedWindow',
    ariaLabel: () => `${t('More actions')}: ${label.text}`,
    itemsFor: () =>
      !isTrailingBlock && !isEditing && !isSearching
        ? [...windowRowButtons, ...savedWindowMenuItems]
        : null,
  });
  const groupMenu = useRowContextMenu({
    kind: 'savedGroup',
    ariaLabel: (groupId) => {
      const group = chromeTabGroups?.find((g) => g.groupId === groupId);
      return `${t('More actions')}: ${group ? groupDisplayName(group) : ''}`;
    },
    itemsFor: (groupId) => {
      const run = items.find(
        (i): i is GroupRun => i.kind === 'group' && i.group.groupId === groupId
      );
      return !isSearching && editingGroupId !== groupId && run !== undefined
        ? [...groupRowButtons(run), ...savedGroupMenuItems(groupId)]
        : null;
    },
  });

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    font-family: ${FONT_FAMILY};
    margin-bottom: 8px;
  `;

  // KAN-708. The strip shows for the hovered row and for the one whose right-click menu is open.
  const isStripShown = isParentHovered || windowMenu.heldId !== null;
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
    /* KAN-708. The row whose right-click menu is open, held as if hovered. */
    ${
      isEditing
        ? ''
        : `&[data-row-menu-held] { background-color: ${COLORS.HOVER_COLOR}; }`
    }
    /* KAN-723. A covered tag hides under parentRightStyle's two reveals: its opacity, and the keyboard's. A search empties the strip. */
    ${!isSearching && isStripShown ? HIDE_TAGS_UNDER_STRIP : ''}
    ${whileKeyNav('&:has([data-row-actions] :focus-visible)')} {
      ${HIDE_TAGS_UNDER_STRIP}
    }
    /* KAN-379. A drag resting here: the sweep, whose end opens the window.
       The press fill, as a session row's (KAN-669). */
    [data-spring-dwell] > & {
      ${springSweepStyle(COLORS.ACTIVE_COLOR)}
      @media (prefers-reduced-motion: reduce) {
        /* Lit at once; the animation stays, because it times the open (D7). */
        background-color: ${COLORS.ACTIVE_COLOR};
        background-image: none;
      }
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
    /* An open menu paints over the tab rows below, later siblings; see openMenuGroupId. */
    z-index: ${isWindowMenuOpen ? 3 : 'auto'};
    /* The mask lands in one frame with the row's fill; only the icons ease
       (KAN-100). They are glyphs over a background that is already uniform, so
       fading them cannot produce an edge -- which is what separates them from
       the mask they sit on. */
    /* No mask while editing: the field is beneath this block, so painting
       HOVER_COLOR here would drop a grey box onto a white input. */
    background-color: ${
      isStripShown && !isEditing ? COLORS.HOVER_COLOR : 'transparent'
    };
    & > * {
      /* isEditing, because the confirm tick is not a hover affordance -- it is
         the editor's own control and has to be there whether or not the
         pointer is. Focus is in the INPUT while editing, which is outside this
         block, so neither isParentHovered nor the focus rule below ever fires
         and the tick was invisible unless the pointer happened to be over the
         row. */
      opacity: ${isStripShown || isEditing ? 1 : 0};
      transition: opacity ${DURATION.COLOR} ease-out;
    }
    /* The keyboard's equivalent of the hover reveal (KAN-68). Keyboard focus
       only (KAN-636, as KAN-94): :focus-within also matched the focus a click
       on ⋮ leaves, so the row stayed engaged after the pointer left. */
    ${whileKeyNav('&:has(:focus-visible)')} {
      background-color: ${COLORS.HOVER_COLOR};
      & > * {
        opacity: 1;
      }
    }
  `;

  const childrenContainerStyle = css`
    padding-left: 70px;
  `;

  // KAN-361/366. The trailing block (NEW_LAST_WINDOW): the one block after
  // the last window, drawn by the pane whatever is dragged. To the drag
  // engine it is a window: its block is marked, and it holds the phantom row
  // a carried tab or group is drawn as -- invisible, keeping its footprint --
  // so the list adopts it there, at the end, and nothing above it moves when
  // a carry starts (KAN-361 N1 B: the New window target is in the header).
  //
  // Zero height at rest: no border, no rows. While a tab or group is dragged
  // or carried in a list that already scrolls (App.css, keyed on
  // data-drag-new-window `room`) it takes its border and one row of room
  // (Q4), so a full list scrolled to its end has a place below its last
  // window. The room is the phantom's own when one rests here, and a blank
  // row (data-new-window-room) when none does, so the block is the same
  // height either way and a carry starting changes nothing.
  //
  // Drawn blank. Lit -- the header target's look (dropBoxStyle,
  // V2 A) and its name -- only while the landing is in it: a tab or group
  // let go below the last window makes a new last window (KAN-366 B). Lit,
  // it is one row tall with its borders whether or not the list gave it
  // room, so in a list that fits it draws its own box in the empty space.
  //
  // While lit, the landing slot is hidden: the lit box is what says where
  // the release lands, and a dashed slot in a dashed box says it twice. The
  // slot is the phantom's child, so it is inside this box wherever it is
  // drawn -- hence only while lit.
  //
  // V1 A: one row tall, whatever is carried. A carried GROUP's phantom is
  // held folded to its header, as any group drag holds the held group
  // (KAN-160) -- but always, not only once held, so the box does not shrink
  // under the pointer as it comes in. The phantom is the only thing this box
  // ever holds, and the engine measures it in this layout.
  //
  // Its band KEEPS its margins: the engine reads the band's own margin into
  // the footprint every preview opens (footprintOf), so a band without one
  // opened a gap 2px smaller than any group drag does (final review, finding
  // 4: derive the box). The box that holds the phantom takes them back
  // instead (trailingRowsStyle): margins that meet collapse, and a band's
  // 2px against that box's -2px is 0, so the header is exactly a tab row's
  // height inside the border.
  const trailingBlockStyle = css`
    position: relative;
    margin-bottom: 0;
    border-width: 0;
    &:not([data-landing]) {
      border-color: transparent;
      /* Not drawn at all: hidden, its content would still overflow the
         block's zero height at rest and add to the pane's scroll range. */
      & > [data-drop-label-unlit-hidden] {
        display: none;
      }
    }
    & [data-group-tabs] {
      display: none;
    }
    & [data-new-window-room] {
      display: none;
      height: ${CONTROL.ROW};
    }
    /* Lit, it is a box of its own whatever room the list gave it: one row
       -- its blank row of room, or the phantom resting in it -- and its
       borders, in the header target's look. In a list that fits it stands
       in the empty space below the last window and is a full row even where
       less than a row is free: the list scrolls a little while it is lit
       (Justine's pick, 2026-10-01; the engine refuses the zone under half a
       row free, publishNewWindowFree). */
    &[data-landing] {
      border-width: 1.5px;
      & [data-new-window-room] {
        display: block;
      }
    }
    &[data-landing] [data-drag-landing-slot] {
      visibility: hidden;
    }
  `;
  const trailingRowsStyle = items.some((item) => item.kind === 'group')
    ? css`
        margin: -${BAND_MARGIN_PX}px 0;
      `
    : undefined;

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
  // KAN-708. Held while its right-click menu is open, as if hovered.
  const heldTabStyle = css`
    background-color: ${COLORS.HOVER_COLOR};
  `;

  // A plain string, not css``: handed to ClickableRow's `style` prop.
  const childLeftStyle = `
    display: flex;
    align-items: center;
    flex-grow: 1;
    min-width: 0;
  `;

  // A saved group row engaged, by hover or keyboard focus: its fill, and its actions shown over a matching mask.
  const groupRowEngaged = `background-color: ${COLORS.HOVER_COLOR};`;
  const groupActionsShown = `
    background-color: ${COLORS.HOVER_COLOR};
    & > * {
      opacity: 1;
    }
  `;

  // KAN-708. A tab row's strip shows on hover, and while its right-click menu is open.
  const isTabEngaged = (tabId: string) =>
    hoveredTabId === tabId || tabMenu.heldId === tabId;

  const childRightStyle = (tabId: string) => css`
    position: absolute;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
    /* Mask in one frame, icons ease -- see parentRightStyle (KAN-100). */
    background-color: ${
      isTabEngaged(tabId) ? COLORS.HOVER_COLOR : 'transparent'
    };
    & > * {
      opacity: ${isTabEngaged(tabId) ? 1 : 0};
      transition: opacity ${DURATION.COLOR} ease-out;
    }
    /* The keyboard's equivalent of the hover reveal (KAN-68). Delete tab has
       no alternate path anywhere in the UI, so this row is the only way to
       reach it. Keyboard focus only, as the window row's (KAN-636). */
    ${whileKeyNav('&:has(:focus-visible)')} {
      background-color: ${COLORS.HOVER_COLOR};
      & > * {
        opacity: 1;
      }
    }
  `;

  // A plain string, not css``, because ClickableRow's `style` prop takes a
  // string. The editing branch below therefore has to wrap it as
  // css(parentLinkStyle): Emotion's `css` PROP rejects a bare string outright
  // ("Strings are not allowed as css prop values"), even though the `css`
  // FUNCTION accepts one. One declaration still serves both branches.
  const parentLinkStyle = `
    text-decoration: none;
    color: inherit;
    display: flex;
    align-items: center;
    height: 100%;
    min-width: 0;
    padding-right: 9px;
  `;

  // KAN-723. Measured as pointer or focus enters the row; the row's CSS decides when a marked tag hides.
  const measureTagsUnder =
    (stripSelector: string) => (e: React.SyntheticEvent<HTMLElement>) =>
      markTagsUnderStrip(
        e.currentTarget,
        e.currentTarget.querySelector<HTMLElement>(stripSelector)
      );

  // KAN-720. The tag's 9px clearance from the row's edge lives here, not in RowTag.
  const rowTagSlotStyle = css`
    display: flex;
    flex-shrink: 0;
    padding-right: 9px;
  `;
  // KAN-720. Pulls back the window title's 6px padding, so the gap from its text stays 8px.
  const windowTagSlotStyle = css`
    ${rowTagSlotStyle};
    margin-left: -6px;
  `;

  // Shrunk to its text, so the rest of the row is only a drag handle (R4, D9).
  // The window row and the group band both fill HOVER_COLOR under the pointer.
  const titleButtonStyle =
    `
    flex: 0 1 auto;
    max-width: 100%;
  ` + renameOnClickStyle(COLORS, COLORS.HOVER_COLOR);

  const renameFieldPlaceholder = placeholderStyle(COLORS.PLACEHOLDER_COLOR);

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

  // The title truncates first, so the pin always shows (KAN-458).
  const markStyle = css`
    display: flex;
    align-items: center;
  `;

  // Unique per window: legacy data can repeat a tab id across windows.
  const descriptionIdPrefix = useId();
  // KAN-564. Each tab's other half, for the pairs a restore splits.
  const splitPartners = savedSplitPartners(tabs);

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
    renameCancelled.current = false;
    setNewTitle(label.named ? title : '');
    setIsEditing(true);
  };

  const handleBlur = () => {
    if (renameCancelled.current) return;
    setIsEditing(false);
    if (title !== newTitle) {
      onUpdateWindowGroupTitle(newTitle);
    }
  };

  const renameGroupLabel = (group: chromeTabGroupData) =>
    t('Rename group') + ': ' + groupDisplayName(group);

  const openGroupLabel = (group: chromeTabGroupData) =>
    t('Open group') + ': ' + groupDisplayName(group);

  const groupTitleLabel = (group: chromeTabGroupData) => (
    <NormalLabel
      value={groupDisplayName(group)}
      color={group.title ? COLORS.LABEL_L2_COLOR : COLORS.LABEL_L3_COLOR}
      size={GROUP_TITLE_SIZE}
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
    // KAN-299. Same rule as the window-level add
    // (TabGroupDetailsContainer): a Tab Keeper page must never be added to
    // a group as if it were a saved tab.
    if (!tab || isTabKeeperPage(tab)) return;
    dispatch(
      addCurrTabToChromeGroupInternal({
        tabGroupId,
        windowId,
        groupId: group.groupId,
        // KAN-211. One definition of how a live tab becomes a stored one, so
        // this cannot drift from a window capture the way the two copies of
        // this literal already had.
        tabData: toStoredTab(tab),
      })
    );
  };

  // Same DRAFT discipline as the window title above (KAN-51): seeded when
  // editing starts rather than kept in step by an effect, so a rename
  // arriving from another device cannot overwrite what is being typed.
  const startEditingGroup = (group: chromeTabGroupData) => {
    groupRenameCancelled.current = false;
    setGroupDraft(group.title);
    setEditingGroupId(group.groupId);
  };

  // A blank is a legitimate result, as for a window: the group falls back to its placeholder.
  // The reducer owns that; this only skips the dispatch when nothing changed, so
  // opening and closing the editor is not a Firestore write.
  const commitGroupRename = (group: chromeTabGroupData) => {
    if (groupRenameCancelled.current) return;
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

  // KAN-708. A tab's items: Open in new tab (unless the tour blocks it), Copy link, Delete tab.
  const tabMenu = useRowContextMenu({
    kind: 'savedTab',
    ariaLabel: (tabId) => tabs.find((tab) => tab.tabId === tabId)?.title ?? '',
    itemsFor: (tabId) => {
      const tab = tabs.find((candidate) => candidate.tabId === tabId);
      if (!tab) return null;
      return [
        ...(isOpenBlocked
          ? []
          : [
              {
                key: 'open',
                label: t('Open in new tab'),
                icon: 'tab' as const,
                onSelect: () => handleTabClick(tab.url),
              },
            ]),
        copyLinkItem(tab.url, { t, dispatch }),
        {
          key: 'delete',
          label: t('Delete tab'),
          icon: 'delete' as const,
          danger: true,
          onSelect: () => dispatch(deleteTab({ tabGroupId, windowId, tabId })),
        },
      ];
    },
  });

  // The group's Open (KAN-394): its tabs beside the active one, re-grouped.
  //
  // The index advances per tab. Creating them all at currentTabIndex + 1 would
  // reverse the group, because each insert pushes the previous one right.
  const openGroup = (run: GroupRun) => {
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
    dispatch(toggleWindowCollapse({ tabGroupId, windowId }));
  }

  const cancelWindowRename = () => {
    renameCancelled.current = true;
    setIsEditing(false);
  };

  const cancelGroupRename = () => {
    groupRenameCancelled.current = true;
    setEditingGroupId(null);
  };

  // Hover is tracked by tabId, not by position (KAN-127). A position-keyed
  // flag points at whichever tab has since moved into that slot, so anything
  // that reorders the list -- a sync adopting the other device's window, or a
  // drag -- reveals the wrong row's actions. It also removes the cross-run
  // index arithmetic this used to need, since a run's local index and the
  // window-wide one no longer have to be reconciled.
  function renderTab(
    { tabId, favicon, title, url, pinned }: tabData,
    grouped: boolean
  ) {
    const pinnedId = `${descriptionIdPrefix}-pinned-${tabId}`;
    // KAN-564 A. The other half of the split this tab restores into.
    const partner = splitPartners.get(tabId);
    const splitId = `${descriptionIdPrefix}-split-${tabId}`;
    const splitText =
      partner === undefined
        ? null
        : t('In a split view with {{title}}', { title: partner.title });
    const describedBy = [
      ...(pinned ? [pinnedId] : []),
      ...(splitText === null ? [] : [splitId]),
    ].join(' ');
    return (
      <div
        key={tabId}
        css={
          tabMenu.heldId === tabId
            ? [childrenStyle, heldTabStyle]
            : childrenStyle
        }
        data-drag-handle-row=""
        onMouseEnter={() => setHoveredTabId(tabId)}
        onMouseLeave={() => setHoveredTabId(null)}
        {...tabMenu.rowProps(tabId)}
      >
        <DragHandle
          scope="tabs"
          rowId={tabId}
          left={grouped ? '-40px' : '-24px'}
          outsideRow
        />
        {/* The name reuses the string the tooltip already carried, so no new
            hardcoded English enters the app -- the 25 untranslated
            aria-labels of KAN-65 stay one clean sweep. The favicon Icon
            inside is presentational and aria-hidden, so it does not leak
            into the name. */}
        <ClickableRow
          ariaLabel={t('Open in new tab') + ': ' + title}
          // As Open now says a pinned tab: its own description, no joiner (KAN-307).
          ariaDescribedBy={describedBy === '' ? undefined : describedBy}
          tooltipText={openBlockedBecause ?? undefined}
          disable={isOpenBlocked}
          onClick={() => handleTabClick(url)}
          style={childLeftStyle}
        >
          <Icon
            faviconUrl={resolveFaviconUrl(favicon, url)}
            type="globe"
            tourAnchor="tab-dot"
            style={`&:hover {background-color: unset;}`}
          />
          <div css={windowChildLinkStyle}>
            <NormalLabel
              value={title}
              color={COLORS.TEXT_COLOR}
              size={TYPE.BODY}
              style="padding-left: 4px; height: 100%; max-width: 100%;"
            />
          </div>
          {(pinned || splitText !== null) && (
            // At the row's end, as Open now draws them (KAN-566).
            <RowMarkSlot>
              {pinned && (
                <span data-pin css={markStyle}>
                  <RowMarkIcon type="keep" />
                </span>
              )}
              {splitText !== null && (
                <span data-split css={markStyle}>
                  <RowMarkIcon type="view_column_2" tooltipText={splitText} />
                </span>
              )}
            </RowMarkSlot>
          )}
        </ClickableRow>
        {pinned && (
          <span id={pinnedId} css={visuallyHiddenStyle}>
            {t('Pinned')}
          </span>
        )}
        {splitText !== null && (
          <span id={splitId} css={visuallyHiddenStyle}>
            {splitText}
          </span>
        )}
        {/* data-row-actions is the stylesheet's hook for hiding this strip
            during a drag (KAN-135). The reveal above is an emotion class keyed
            on React state, which App.css cannot name. */}
        <div data-row-actions css={childRightStyle(tabId)}>
          <Icon
            tooltipText={t('Delete tab')}
            ariaLabel={t('Delete tab')}
            type="delete"
            danger
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
    // data-drop-window-id marks the WHOLE window block -- header and tabs,
    // rendered whether the window is open or collapsed -- as what
    // windowBlockAt hit-tests (KAN-132). Not the tab-list wrapper below: a drop on
    // this window's header, and a drop anywhere on a collapsed window (which
    // renders no tab-list wrapper at all), both have to answer "this window",
    // and this is the one element that is always there to say so.
    <div
      css={
        isTrailingBlock
          ? [containerStyle, dropBoxStyle(COLORS), trailingBlockStyle]
          : containerStyle
      }
      data-drop-window-id={windowId}
      // KAN-379. What the engine reads to know a block is drawn folded.
      data-window-collapsed={!isTrailingBlock && !isWindowOpen ? '' : undefined}
      // KAN-361/366. Lit by markNewWindowTarget while the landing is in it.
      data-new-window-target={isTrailingBlock ? 'last' : undefined}
      // Only a pointer's drag ever shows it, and it holds no row of its own.
      aria-hidden={isTrailingBlock ? 'true' : undefined}
      // KAN-184. The room a drop into ANOTHER window needs, made here.
      //
      // A preview holds the layout still and moves everything by transform, so
      // a window cannot grow: its rows below the landing used to slide down and
      // spill over the next window's header, and at its end no gap opened at
      // all. Moving the blocks between the source and the destination opens
      // that row of space for real.
      //
      // THIS element and not the DraggableRow above it, whose transform belongs
      // to the WINDOW drag -- two states on one channel is the mistake this
      // file's header warns about, and nesting the two means neither has to
      // know about the other.
      //
      // The shift is published back so windowBlockAt can subtract it: growing
      // the preview must not move what the pointer can hit, the same rule
      // KAN-171 settled for a band's padding.
      data-window-shift={windowShift || undefined}
      // NO TRANSITION, unlike the rows stepping aside inside it. The held row
      // and its landing slot are drawn inside a block that may be moving, and
      // both give that movement back by subtracting the shift -- a number, not
      // an animation. Eased, the block is somewhere in between while they
      // subtract the whole of it, and the ghost drifts by the remainder:
      // measured 27px of a 34px shift, which is what it cost to learn.
      style={{
        transform: windowShift ? `translateY(${windowShift}px)` : undefined,
      }}
    >
      {isTrailingBlock ? (
        // The target's name, over the phantom below it, shown while lit.
        <DropBoxLabel text={t('CarryNewWindowTarget')} hiddenUnlessLit />
      ) : (
        /* The grab handle for the WINDOW drag (KAN-129), read by the area
            above this component through its handleSelector. It has to be the
            header alone: the draggable node wraps this row AND the tab list
            below it, so a handle covering the whole block would start a window
            drag from every tab drag. Marked with an attribute rather than
            plumbed down as a prop, matching data-band-id beside it -- and the
            area checks the handle it finds is CONTAINED by the row, so this
            cannot be satisfied by anything outside the window it belongs to. */
        <div
          data-window-drag-handle
          data-drag-handle-row=""
          css={parentStyle}
          {...windowMenu.rowProps(windowId)}
          onMouseEnter={() => setIsParentHovered(true)}
          onMouseLeave={() => setIsParentHovered(false)}
          onPointerEnter={measureTagsUnder('[data-row-actions]')}
          onFocus={measureTagsUnder('[data-row-actions]')}
        >
          <div css={parentLeftStyle}>
            <Icon
              tooltipText={isWindowOpen ? t('Collapse') : t('Expand')}
              // Names its window, as Open now's does (KAN-303).
              ariaLabel={
                (isWindowOpen ? t('Collapse') : t('Expand')) + ': ' + label.text
              }
              ariaExpanded={isWindowOpen}
              type={isWindowOpen ? 'expand_less' : 'expand_more'}
              // KAN-757. Turns over on a fold change rather than swapping glyphs.
              renderGlyph={(glyphCss) => (
                <ChevronGlyph open={isWindowOpen} glyphCss={glyphCss} />
              )}
              onClick={handleAccordionClick}
            />
            <DragHandleSwap rowId={windowId}>
              <Icon type="web_asset" style={NON_INTERACTIVE_ICON_STYLE} />
            </DragHandleSwap>
            {/* Two shapes, because an <input> may not live inside a <button>:
                clicking it would activate the button and it could not hold
                focus. Otherwise the title is the rename button, searching or
                not (R1, R7). */}
            {isEditing ? (
              // padding-right: 0 overrides parentLinkStyle's 9px, which exists
              // to keep the RESTING title clear of the action icons. While
              // editing there is no title to keep clear, and the reserved gap
              // left the field stopping 9px short of the row's edge.
              <div
                css={css(
                  parentLinkStyle +
                    'flex-grow: 1; padding-right: 0;' +
                    focusRingOverTickCss(COLORS, '&:has(> input:focus-visible)')
                )}
              >
                <input
                  value={newTitle}
                  placeholder={t('Name this window')}
                  onBlur={handleBlur}
                  onChange={handleChange}
                  onKeyDown={(e) =>
                    renameKeyDown(
                      e,
                      () => {
                        titleFocus.ask('window');
                        handleBlur();
                      },
                      () => {
                        titleFocus.ask('window');
                        cancelWindowRename();
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
                    font-size: ${TYPE.BODY};
                    padding-left: 8px;
                    height: 100%;
                    width: 100%;
                    min-width: 0;
                    &:focus {
                      outline: none;
                    }
                    ${renameFieldPlaceholder}
                  `}
                />
              </div>
            ) : (
              <>
                <ClickableRow
                  ariaLabel={t('Rename window') + ': ' + label.text}
                  onClick={startEditing}
                  buttonRef={titleFocus.refFor('window')}
                  // KAN-720. 6px keeps the text 2px clear of the inset ring (KAN-685); the tag's slot takes it back.
                  style={
                    parentLinkStyle + 'padding-right: 6px;' + titleButtonStyle
                  }
                >
                  <NormalLabel
                    value={label.text}
                    color={labelColor}
                    size={TYPE.BODY}
                    style="padding-left: 8px; height: 100%; max-width: 100%;"
                  />
                </ClickableRow>
                <span css={windowTagSlotStyle}>
                  <RowTag value={formatTabCount(tabs.length, t)} />
                </span>
              </>
            )}
          </div>
          <div data-row-actions css={parentRightStyle}>
            {isEditing ? (
              // Same shape as the session tick: the wrapper carries the
              // onMouseDown that Icon does not expose, preventDefault keeps focus
              // in the input so onClick is the single commit path, and the
              // wrapper itself is what stops the post-commit click retargeting
              // onto the Open button that replaces this tick.
              <span onMouseDown={(e) => e.preventDefault()}>
                <Icon
                  tooltipText={t('Save changes')}
                  ariaLabel={t('Save changes')}
                  type="done"
                  onClick={(e) => {
                    e.stopPropagation();
                    titleFocus.ask('window');
                    handleBlur();
                  }}
                />
              </span>
            ) : (
              // Hidden while searching, as every whole-item action is (R7).
              !isSearching && (
                <RowOpenButton
                  ariaLabel={t('Open in new window') + ': ' + label.text}
                  tooltipText={openBlockedBecause ?? t('Open in new window')}
                  disable={isOpenBlocked}
                  onClick={onOpenWindow}
                />
              )
            )}

            {/* KAN-279 D13. This page IS Tab Keeper's own tab in the tab view,
                so "current tab" could only ever mean itself; hidden there. */}
            {!isEditing && !isSearching && !isTabView() && (
              <Icon
                tooltipText={t('Add current tab')}
                ariaLabel={t('Add current tab')}
                type="add"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddCurrTabToWindowClick();
                }}
              />
            )}
            {/* KAN-616 (1A). Delete moved in here so Remove duplicate tabs
                adds no fourth icon over a long title, as on a group band. */}
            {!isEditing && !isSearching && (
              <OverflowMenu
                ariaLabel={t('More actions')}
                onOpenChange={setIsWindowMenuOpen}
                items={savedWindowMenuItems}
              />
            )}
          </div>
        </div>
      )}
      {(isWindowOpen || isTrailingBlock) && (
        // data-window-tabs is the hook App.css uses to fold every window shut
        // while a WINDOW is being dragged (KAN-153). Visual only -- the stored
        // fold state is never touched, which is what makes "and it comes back
        // how it was" require no bookkeeping at all. That still holds now the
        // state lives in globalState rather than here (KAN-206): the drag folds
        // with CSS and dispatches nothing, so the two mechanisms never meet.
        // markRowContainer: this box holds one window's worth of the pane-wide
        // `items` list, so no row's footprint is ever measured on it
        // (KAN-132). Its own list container used to sit here and say the same
        // thing; with one list for the whole session, that container is far
        // above and nothing else tells this box from the single-child wrappers
        // a footprint's climb exists to climb.
        //
        // The trailing block holds the carried item's phantom here instead
        // (KAN-350): its rows, not a window's, so nothing folds it and it
        // takes no indent -- or, with none resting in it, its blank row of
        // room.
        <div
          css={isTrailingBlock ? trailingRowsStyle : childrenContainerStyle}
          data-window-tabs={isTrailingBlock ? undefined : ''}
          ref={markRowContainer}
        >
          {isTrailingBlock && items.length === 0 && (
            <div data-new-window-room="" />
          )}
          {/* KAN-160. The window's items -- loose tabs and whole groups.
                Item rows name scope="items" and tab rows name scope="tabs",
                so each joins its own pane-wide list past the other
                (KAN-132); a window provides neither list itself. */}
          {items.map((item, index) =>
            item.kind === 'tab' ? (
              <DraggableRow
                key={itemIdOf(item)}
                scope="items"
                rowId={itemIdOf(item)}
              >
                <DraggableRow scope="tabs" rowId={item.tab.tabId}>
                  {renderTab(item.tab, false)}
                </DraggableRow>
              </DraggableRow>
            ) : (
              <DraggableRow
                key={itemIdOf(item)}
                scope="items"
                rowId={itemIdOf(item)}
              >
                <div
                  data-band-id={item.group.groupId}
                  data-after-group={
                    index > 0 && items[index - 1].kind === 'group'
                      ? ''
                      : undefined
                  }
                  data-before-group={
                    items[index + 1]?.kind === 'group' ? '' : undefined
                  }
                  role="group"
                  aria-label={item.group.title || t('Unnamed group')}
                  css={css`
                    display: flex;
                    align-items: stretch;

                    margin: ${BAND_MARGIN_PX}px 0;

                    /* KAN-179: the ungrouped landing between two adjacent
                       groups is the gap between their bands, and two
                       collapsing margins leave only one of them. Widened
                       here, on the lower band, because a bottom margin is
                       what footprintOf measures. GroupFrameFollower reads
                       this attribute back to know what to restore. */
                    &[data-after-group] {
                      margin-top: ${ADJACENT_GROUP_GAP_PX}px;
                    }

                    /* KAN-186. While this group is the row being dragged, the
                       band paints the row's own hover fill.

                       The strip keeps 16px of horizontal footprint however
                       wide it is drawn -- 7px of colour plus 9px of margin it
                       grows into when the band is a drop target
                       (GroupColorPicker; 3 + 6 before KAN-231) -- and that
                       margin belongs to the BAND, which is transparent. At
                       rest the page shows through it and nobody can tell;
                       held, the row floats over the other rows and those 9px
                       become a window onto whatever it is passing over.
                       Measured before KAN-231: the strip ended at 438.5 and
                       the row's own fill started at 444.5; the gap is the
                       same kind, 3px wider.

                       The held row is hovered by definition -- it tracks the
                       pointer -- so this is the colour already beside it. */
                    [data-drag-held] & {
                      background-color: ${COLORS.HOVER_COLOR};
                    }

                    /* KAN-169. The drop removes this group: its only member
                       is held outside it. The band's box has to stay -- the
                       preview holds the layout still, and the held row is
                       still a child of it -- so the chrome fades instead: the
                       title row and the colour strip, at the pace the rows
                       below glide up over them. */
                    &[data-drag-removed] [data-group-drag-handle],
                    &[data-drag-removed] [data-group-color-strip] {
                      opacity: 0;
                      transition: opacity ${DURATION.MOVE} ease;
                    }

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
                      border-radius: ${RADIUS.SQUARE};
                    }
                  `}
                >
                  <GroupFrameFollower
                    groupId={item.group.groupId}
                    scope="tabs"
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
                      data-drag-handle-row=""
                      // KAN-166. This row is DRAWN in the tab list but is
                      // not one of its rows, and the preview has to count
                      // it: a tab dropped on it joins the group without
                      // changing its row index, which in a list of rows
                      // alone is indistinguishable from not moving at all.
                      data-fixed-row-id={item.group.groupId}
                      css={css`
                        position: relative;
                        display: flex;
                        align-items: center;
                        /* KAN-165: the frame travels with its tabs, so it
                               has to glide like they do. Same duration as the
                               rows stepping aside in RowDragArea. */
                        transition: transform ${DURATION.MOVE} ease;
                        /* 32px, the height the window row and every tab row
                         already stand at -- measured, not guessed. At 22px the
                         hover fill read as a short band wedged between
                         full-height ones. It is also exactly the action icons'
                         height, so they now fit the row rather than
                         overflowing a shorter one. */
                        min-height: 32px;
                        ${focusRingOverTickCss(
                          COLORS,
                          '&:has(> input:focus-visible)'
                        )}
                        /* Fills like the window row above and the tab rows
                         below, which both paint HOVER_COLOR under the pointer.
                         Without it this row revealed its actions while giving
                         no sign of being hovered at all.

                         Both triggers, because the actions appear on both:
                         reveal and fill are one visual state with one trigger
                         (KAN-100), and filling on only one is how they came
                         apart last time. Keyboard focus only (KAN-636, as
                         KAN-94), each in its own rule beside :hover.

                         No transition on the fill, also KAN-100 -- easing it
                         lets the row reach the colour in two halves with a
                         visible edge between them. */
                        &:hover {
                          ${groupRowEngaged}
                        }
                        ${whileKeyNav('&:has(:focus-visible)')} {
                          ${groupRowEngaged}
                        }
                        /* The mask lands with the fill; only the controls ease (D10, KAN-100). */
                        &:hover .group-actions {
                          ${groupActionsShown}
                        }
                        ${whileKeyNav('&:has(:focus-visible) .group-actions')} {
                          ${groupActionsShown}
                        }
                        /* KAN-723. Each reveal also hides the tags its strip would cover. A search empties the strip. */
                        ${
                          isSearching
                            ? ''
                            : `&:hover { ${HIDE_TAGS_UNDER_STRIP} }
                               ${whileKeyNav('&:has(:focus-visible)')} { ${HIDE_TAGS_UNDER_STRIP} }`
                        }
                        /* KAN-708. Held while its right-click menu is open, as if hovered. */
                        ${
                          groupMenu.heldId === item.group.groupId
                            ? `${groupRowEngaged} .group-actions { ${groupActionsShown} } ${HIDE_TAGS_UNDER_STRIP}`
                            : ''
                        }
                      `}
                      {...groupMenu.rowProps(item.group.groupId)}
                      onPointerEnter={measureTagsUnder('.group-actions')}
                      onFocus={measureTagsUnder('.group-actions')}
                    >
                      <DragHandle
                        scope="items"
                        rowId={itemIdOf(item)}
                        left="-40px"
                        outsideRow
                      />
                      {editingGroupId === item.group.groupId ? (
                        <input
                          value={groupDraft}
                          aria-label={renameGroupLabel(item.group)}
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
                            /* Matches groupTitleLabel exactly -- the editor
                               replaces that label in place, so a different size
                               makes the text jump on entering edit mode. Both
                               are the documented off-scale exemption; see
                               scaleConformance.test.ts. */
                            font-size: ${GROUP_TITLE_SIZE};
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
                            ${renameFieldPlaceholder}
                          `}
                        />
                      ) : (
                        // WCAG 2.5.3, same shape as KAN-77: the accessible name
                        // CONTAINS the visible one, so "click Research" works.
                        // Renames searching or not (R7); the strip masks the title's end, no room reserved (D10).
                        <ClickableRow
                          ariaLabel={renameGroupLabel(item.group)}
                          onClick={() => startEditingGroup(item.group)}
                          buttonRef={titleFocus.refFor(item.group.groupId)}
                          // align-self, because the strip centres its children
                          // -- without it the clickable is only as tall as its
                          // text and the row has 8px of dead zone above and
                          // below, while the hover fill paints the full 32px.
                          // The tab rows get this from their parent's
                          // align-items: stretch; this strip has to ask.
                          style={
                            // The ghost reaches 4px past the text, as the label's 4px left; no padding, so a long title still runs to the edge (D10).
                            'display: flex; align-items: center; align-self: stretch; min-width: 0; box-sizing: border-box;' +
                            titleButtonStyle +
                            '&::before { right: -4px; }' +
                            // KAN-685: the box is only as wide as the text, so the ring goes outside it.
                            focusRingOutsideCss(COLORS)
                          }
                        >
                          {groupTitleLabel(item.group)}
                        </ClickableRow>
                      )}
                      {editingGroupId !== item.group.groupId && (
                        <span css={rowTagSlotStyle}>
                          <RowTag value={formatTabCount(item.tabs.length, t)} />
                        </span>
                      )}
                      {editingGroupId === item.group.groupId && (
                        // preventDefault keeps focus in the input, so onClick is the one commit path.
                        <span
                          data-row-actions
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
                              titleFocus.ask(item.group.groupId);
                              commitGroupRename(item.group);
                            }}
                          />
                        </span>
                      )}
                      {editingGroupId !== item.group.groupId && (
                        // data-row-actions: hidden while any drag is in flight
                        // (KAN-135). The held group's title row stays hovered
                        // for the whole drag.
                        <div
                          data-row-actions
                          className="group-actions"
                          css={css`
                            position: absolute;
                            top: 50%;
                            right: 0;
                            transform: translateY(-50%);
                            & > * {
                              opacity: 0;
                              transition: opacity ${DURATION.COLOR} ease-out;
                            }
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
                            z-index: ${
                              openMenuGroupId === item.group.groupId ? 3 : 1
                            };
                          `}
                        >
                          {/* Hidden while searching, like every whole-item action (R7). */}
                          {!isSearching && (
                            <RowOpenButton
                              ariaLabel={openGroupLabel(item.group)}
                              tooltipText={
                                openBlockedBecause ?? t('Open group')
                              }
                              disable={isOpenBlocked}
                              onClick={() => openGroup(item)}
                            />
                          )}
                          {/* KAN-279 D13. Same reasoning as the window
                                row's Add current tab: meaningless in the tab
                                view, so hidden there too. */}
                          {!isSearching && !isTabView() && (
                            <Icon
                              tooltipText={t('Add current tab to group')}
                              ariaLabel={t('Add current tab to group')}
                              type="add"
                              onClick={(e) => {
                                e.stopPropagation();
                                addCurrentTabToGroup(item.group);
                              }}
                            />
                          )}
                          {/* Ungroup and delete live behind the overflow rather
                            than as two more icons: four 32px icons overlap a
                            long title from 125% zoom, and "Ungroup" is not a
                            concept named anywhere else in this UI, so it needs
                            a word rather than a glyph. */}
                          {!isSearching && (
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
                              items={savedGroupMenuItems(item.group.groupId)}
                            />
                          )}
                        </div>
                      )}
                    </div>
                    <div data-group-tabs>
                      {item.tabs.map((tabItem) => (
                        <DraggableRow
                          key={tabItem.tabId}
                          scope="tabs"
                          rowId={tabItem.tabId}
                        >
                          {renderTab(tabItem, true)}
                        </DraggableRow>
                      ))}
                      {/* KAN-175. The group's TAIL, declared the same way
                              its title row declares its head. Zero height, so
                              it changes no layout -- it exists only to hold a
                              place in the drawn list, where previewShifts
                              decides it like any other slot: a tab landing
                              BEFORE it is joining at the tail, so the marker
                              holds still and the frame keeps covering the new
                              member; one landing AFTER it is going outside, so
                              the marker rises with the members and the frame's
                              bottom comes up with it.

                              Before this the frame's bottom was DERIVED from
                              the last member's shift, which assumes the last
                              member stays last -- and it does not when the
                              group is gaining or losing one. */}
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
            )
          )}
        </div>
      )}
      {/* KAN-708. Outside every row that carries a menu's handlers (R1). */}
      {windowMenu.menu}
      {groupMenu.menu}
      {tabMenu.menu}
    </div>
  );
};

export default WindowEntryContainer;
