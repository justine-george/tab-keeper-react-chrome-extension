import React, { MouseEventHandler, useState } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import ClickableRow from '../../common/ClickableRow';
import Icon from '../../common/Icon';
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
} from '../../../redux/slices/tabContainerDataStateSlice';
import { useTranslation } from 'react-i18next';
import {
  partitionTabsIntoRuns,
  sanitizeTabGroupColor,
  TAB_GROUP_COLOR_HEX,
} from '../../../utils/functions/tabGroups';
import type { chromeTabGroupData } from '../../../utils/functions/tabGroups';

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
  const [hoveredChildIndex, setHoveredChildIndex] = useState<number | null>(
    null
  );

  const isSearchPanel = useSelector(
    (state: RootState) => state.globalState.isSearchPanel
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
    transition: background-color 0.2s;
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
    opacity: ${isParentHovered ? 1 : 0};
    transition: opacity 0.1s ease-out;
    /* The keyboard's equivalent of the hover reveal (KAN-68). */
    &:focus-within {
      opacity: 1;
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
    transition: background-color 0.2s;
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
    opacity: ${hoveredChildIndex === index ? 1 : 0};
    transition: opacity 0.1s ease-out;
    /* The keyboard's equivalent of the hover reveal (KAN-68). Delete tab has
       no alternate path anywhere in the UI, so this row is the only way to
       reach it. */
    &:focus-within {
      opacity: 1;
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
            backgroundColor={COLORS.HOVER_COLOR}
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
            <div css={css(parentLinkStyle)}>
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
            <Icon
              tooltipText={t('Save changes')}
              ariaLabel={t('Save changes')}
              type="done"
              backgroundColor={COLORS.HOVER_COLOR}
              onClick={(e) => {
                e.stopPropagation();
                handleBlur();
              }}
            />
          ) : (
            <Icon
              tooltipText={t('Rename window group')}
              ariaLabel={t('Rename window group')}
              type="edit"
              backgroundColor={COLORS.HOVER_COLOR}
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
              backgroundColor={COLORS.HOVER_COLOR}
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
              backgroundColor={COLORS.HOVER_COLOR}
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
          {partitionTabsIntoRuns(tabs, chromeTabGroups).map((run, runIndex) =>
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
                  {/* An untitled group renders as the band alone, matching
                      how Chrome itself shows one (BINDING CONSTRAINT 2). The
                      name still reaches a screen reader through the
                      aria-label on the role="group" element above. */}
                  {run.group.title && (
                    <NormalLabel
                      value={run.group.title}
                      color={COLORS.LABEL_L2_COLOR}
                      size="0.8rem"
                      style="padding-left: 4px;"
                    />
                  )}
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
