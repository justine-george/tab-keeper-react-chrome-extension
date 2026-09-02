import React, { MouseEventHandler, useState } from 'react';

import { useSelector } from 'react-redux';

import { css } from '@emotion/react';

import ClickableRow from '../../common/ClickableRow';
import Icon from '../../common/Icon';
import { NormalLabel } from '../../common/Label';
import { RootState } from '../../../redux/store';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { useThemeColors } from '../../../hooks/useThemeColors';
import {
  formatGroupCounts,
  getPrettyDate,
  isSearchActive,
} from '../../../utils/functions/local';
import { tabContainerData } from '../../../redux/slices/tabContainerDataStateSlice';
import { useTranslation } from 'react-i18next';

interface TabGroupEntryProps {
  tabGroupData: tabContainerData;
  /**
   * Takes no event. It was typed MouseEventHandler while its only caller
   * passed a zero-argument arrow, which is what let the old keyboard path get
   * away with `onTabGroupClick(e as any)` -- handing a KeyboardEvent to
   * something the compiler believed was a MouseEventHandler.
   */
  onTabGroupClick: () => void;
  onOpenAllClick: MouseEventHandler;
  onFocusClick: MouseEventHandler;
  onDeleteClick: MouseEventHandler;
}

const TabGroupEntry: React.FC<TabGroupEntryProps> = ({
  tabGroupData,
  onTabGroupClick,
  onOpenAllClick,
  onFocusClick,
  onDeleteClick,
}) => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();

  const [isHovered, setIsHovered] = useState(false);

  const isSearchPanel = useSelector(
    (state: RootState) => state.globalState.isSearchPanel
  );

  // Needed as well as isSearchPanel: the row's counts are narrowed only while
  // the box has text in it, so the panel being open is not on its own enough
  // to call them matches.
  const searchInputText = useSelector(
    (state: RootState) => state.globalState.searchInputText
  );

  const handleMouseEnter = () => setIsHovered(true);
  const handleMouseLeave = () => setIsHovered(false);

  const { title, createdTime, createdAt, windowCount, tabCount, isSelected } =
    tabGroupData;

  // A plain string, not css``, because it is handed to ClickableRow's `style`
  // prop, which composes it into the button's own reset.
  const leftStyle = `
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 8px;
    align-items: flex-start;
    width: 100%;
    min-width: 0;
  `;

  const rightStyle = css`
    position: absolute;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
    display: flex;
    flex-direction: row;
    height: 100%;
    justify-content: flex-start;
    align-items: center;
    opacity: ${isHovered ? 1 : 0};
    transition: opacity 0.1s ease-out;
    /* Hover reveals these to a pointer; focus-within is the same reveal for
       the keyboard. Without it the controls are in the tab order (KAN-68) but
       land on something invisible, which is arguably worse than not reaching
       them at all. */
    &:focus-within {
      opacity: 1;
    }
  `;

  const containerStyle = css`
    position: relative;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: ${FONT_FAMILY};
    cursor: pointer;
    transition: background-color 0.2s;
    &:hover {
      background-color: ${!isSelected && COLORS.HOVER_COLOR};
    }
    background-color: ${isSelected && COLORS.SELECTION_COLOR};
  `;

  // The row's primary action lives on the inner ClickableRow, not on this
  // container, and that placement is the whole fix for KAN-64. The container
  // was a role-less div carrying tabIndex={0} and onClick: focusable, but
  // exposed as `generic`, where ARIA prohibits naming -- so it reached the
  // tab order as an anonymous stop that announced nothing.
  //
  // It cannot simply become a <button> or gain role="button" either, because
  // the Open/Switch/Delete controls are inside it and nesting buttons is
  // invalid HTML. Moving the action onto the left column instead makes them
  // siblings. `leftStyle` is width: 100%, so the clickable area is unchanged;
  // the action block is absolutely positioned on top of it.
  return (
    <div
      css={containerStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <ClickableRow
        ariaLabel={title}
        onClick={onTabGroupClick}
        style={leftStyle}
      >
        <NormalLabel
          style="max-width: 100%;"
          value={title}
          color={COLORS.TEXT_COLOR}
          size="0.95rem;"
          tooltipText={title}
        />
        <NormalLabel
          value={formatGroupCounts(
            windowCount,
            tabCount,
            isSearchActive(isSearchPanel, searchInputText),
            t
          )}
          color={COLORS.LABEL_L1_COLOR}
          size="0.7rem"
          style="margin-top: 2px;"
        />
        <div
          css={css`
            color: ${COLORS.LABEL_L2_COLOR};
            font-size: 0.635rem;
            margin-top: 5px;
          `}
        >
          {/* createdAt is the instant; createdTime is a local wall clock with
              no offset, kept only for sessions saved before createdAt. */}
          {getPrettyDate(createdAt ?? createdTime)}
        </div>
      </ClickableRow>
      {!isSearchPanel && (
        <div css={rightStyle}>
          <Icon
            tooltipText={t('Open session')}
            text={t('Open')}
            ariaLabel="open all windows"
            type="reopen_window"
            backgroundColor={
              isSelected ? COLORS.SELECTION_COLOR : COLORS.HOVER_COLOR
            }
            onClick={(e) => {
              e.stopPropagation();
              onOpenAllClick(e);
            }}
            style="padding: 14px 10px; width: 57px;"
          />
          <Icon
            tooltipText={t('Switch to session')}
            text={t('Switch')}
            ariaLabel="switch to session"
            type="filter_center_focus"
            backgroundColor={
              isSelected ? COLORS.SELECTION_COLOR : COLORS.HOVER_COLOR
            }
            onClick={(e) => {
              e.stopPropagation();
              onFocusClick(e);
            }}
            style="padding: 14px 10px; width: 57px;"
          />
          <Icon
            tooltipText={t('Delete session')}
            text={t('Delete')}
            ariaLabel="delete session"
            type="delete"
            backgroundColor={
              isSelected ? COLORS.SELECTION_COLOR : COLORS.HOVER_COLOR
            }
            onClick={(e) => {
              e.stopPropagation();
              onDeleteClick(e);
            }}
            style="padding: 14px 10px; width: 57px;"
          />
        </div>
      )}
    </div>
  );
};

export default TabGroupEntry;
