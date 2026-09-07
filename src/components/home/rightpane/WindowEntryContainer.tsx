import React, { MouseEventHandler, useState } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import ClickableRow from '../../common/ClickableRow';
import Icon from '../../common/Icon';
import OverflowMenu from '../../common/OverflowMenu';
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
} from '../../../redux/slices/tabContainerDataStateSlice';
import { useTranslation } from 'react-i18next';
import { v4 as uuidv4 } from 'uuid';
import {
  partitionTabsIntoRuns,
  sanitizeTabGroupColor,
  TAB_GROUP_COLOR_HEX,
} from '../../../utils/functions/tabGroups';
import type {
  chromeTabGroupData,
  TabRun,
} from '../../../utils/functions/tabGroups';
import { applyTabGroups } from '../../../utils/functions/windows';

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
  const [hoveredChildIndex, setHoveredChildIndex] = useState<number | null>(
    null
  );

  const isSearchPanel = useSelector(
    (state: RootState) => state.globalState.isSearchPanel
  );

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

  const childRightStyle = (index: number) => css`
    position: absolute;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
    /* Mask in one frame, icons ease -- see parentRightStyle (KAN-100). */
    background-color: ${hoveredChildIndex === index
      ? COLORS.HOVER_COLOR
      : 'transparent'};
    & > * {
      opacity: ${hoveredChildIndex === index ? 1 : 0};
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
  const handleGroupClick = (run: TabRun) => {
    if (run.kind !== 'group') return;
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

  // `index` is hover bookkeeping against hoveredChildIndex, which is this
  // component's own state -- it is not an identity for the row and must not
  // be used as the key. Callers pass tabs.indexOf(tabItem) so the count runs
  // across the whole window rather than restarting inside each group's run;
  // getting that wrong makes hovering one tab highlight another.
  function renderTab({ tabId, favicon, title, url }: tabData, index: number) {
    return (
      <div
        key={tabId}
        css={childrenStyle}
        onMouseEnter={() => setHoveredChildIndex(index)}
        onMouseLeave={() => setHoveredChildIndex(null)}
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
        <div css={childRightStyle(index)}>
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
      <div
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
        <div css={parentRightStyle}>
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
        <div css={childrenContainerStyle}>
          {partitionTabsIntoRuns(
            tabs,
            hasTabGroupsPermission ? chromeTabGroups : undefined
          ).map((run, runIndex) =>
            run.kind === 'ungrouped' ? (
              <React.Fragment key={`ungrouped-${runIndex}`}>
                {run.tabs.map((tabItem) =>
                  renderTab(tabItem, tabs.indexOf(tabItem))
                )}
              </React.Fragment>
            ) : (
              <div
                key={run.group.groupId}
                role="group"
                aria-label={run.group.title || t('Unnamed group')}
                css={css`
                  display: flex;
                  align-items: stretch;
                  margin: 2px 0;
                `}
              >
                {/* The colour is Chrome's own group identity, not app chrome
                    (BINDING CONSTRAINT 1) -- TAB_GROUP_COLOR_HEX is a fixed
                    map, not routed through useThemeColors, so it reads the
                    same in every theme as it does in the browser.

                    It is also purely decorative: the accessible name and the
                    role="group" boundary above already carry the grouping, so
                    this band is a separate aria-hidden element rather than
                    living on the labelled node itself (BINDING CONSTRAINT 3). */}
                <div
                  aria-hidden="true"
                  css={css`
                    flex: 0 0 3px;
                    width: 3px;
                    margin-right: 6px;
                    background-color: ${TAB_GROUP_COLOR_HEX[
                      sanitizeTabGroupColor(run.group.color)
                    ]};
                  `}
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
                  <div
                    css={css`
                      position: relative;
                      display: flex;
                      align-items: center;
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
                    {editingGroupId === run.group.groupId && !isSearchPanel ? (
                      <input
                        value={groupDraft}
                        aria-label={renameGroupLabel(run.group)}
                        onBlur={() => commitGroupRename(run.group)}
                        onChange={(e) => setGroupDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitGroupRename(run.group);
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
                      groupTitleLabel(run.group)
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
                        ariaLabel={openGroupLabel(run.group)}
                        tooltipText={t('Open group')}
                        onClick={() => handleGroupClick(run)}
                        // align-self, because the strip centres its children
                        // -- without it the clickable is only as tall as its
                        // text and the row has 8px of dead zone above and
                        // below, while the hover fill paints the full 32px.
                        // The tab rows get this from their parent's
                        // align-items: stretch; this strip has to ask.
                        style="display: flex; align-items: center; align-self: stretch; min-width: 0; width: 100%; padding-right: 100px; box-sizing: border-box;"
                      >
                        {groupTitleLabel(run.group)}
                      </ClickableRow>
                    )}
                    {editingGroupId === run.group.groupId && !isSearchPanel && (
                      // Same shape as the other two ticks: the wrapper stops
                      // the post-commit click retargeting onto the pencil, and
                      // preventDefault keeps focus in the input so onClick is
                      // the single commit path.
                      <span
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
                            commitGroupRename(run.group);
                          }}
                        />
                      </span>
                    )}
                    {editingGroupId !== run.group.groupId && !isSearchPanel && (
                      <div
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
                          z-index: ${openMenuGroupId === run.group.groupId
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
                            startEditingGroup(run.group);
                          }}
                        />
                        <Icon
                          tooltipText={t('Add current tab to group')}
                          ariaLabel={t('Add current tab to group')}
                          type="add"
                          onClick={(e) => {
                            e.stopPropagation();
                            addCurrentTabToGroup(run.group);
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
                                ? run.group.groupId
                                : prev === run.group.groupId
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
                                    groupId: run.group.groupId,
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
                                    groupId: run.group.groupId,
                                  })
                                ),
                            },
                          ]}
                        />
                      </div>
                    )}
                  </div>
                  {run.tabs.map((tabItem) =>
                    renderTab(tabItem, tabs.indexOf(tabItem))
                  )}
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
};

export default WindowEntryContainer;
