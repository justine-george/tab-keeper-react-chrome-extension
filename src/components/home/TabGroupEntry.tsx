import React, { MouseEventHandler, useState } from 'react';
import { css } from '@emotion/react';
import Icon from '../common/Icon';
import { NormalLabel } from '../common/Label';
import { Tag } from '../common/Tag';
import { useThemeColors } from '../hook/useThemeColors';
import { tabContainerData } from '../../redux/slice/tabContainerDataStateSlice';

interface TabGroupEntryProps {
  tabGroupData: tabContainerData;
  onTabGroupClick: MouseEventHandler;
  onOpenAllClick: MouseEventHandler;
  onDeleteClick: MouseEventHandler;
}

const TabGroupEntry: React.FC<TabGroupEntryProps> = ({
  tabGroupData,
  onTabGroupClick,
  onOpenAllClick,
  onDeleteClick,
}) => {
  const COLORS = useThemeColors();

  const [isHovered, setIsHovered] = useState(false);

  const handleMouseEnter = () => setIsHovered(true);
  const handleMouseLeave = () => setIsHovered(false);

  const { title, createdTime, isAutoSave, windowCount, tabCount, isSelected } =
    tabGroupData;

  function handleKeyPress(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter') {
      onTabGroupClick(e as any);
    }
  }

  const leftStyle = css`
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 8px;
    align-items: flex-start;
    width: 100%;
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
    align-items: flex-start;
    opacity: ${isHovered ? 1 : 0};
    transition: opacity 0.1s ease-out;
  `;

  const containerStyle = css`
    position: relative;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: 'Libre Franklin', sans-serif;
    cursor: pointer;
    transition: background-color 0.3s;
    &:hover {
      background-color: ${!isSelected && COLORS.HOVER_COLOR};
    }
    background-color: ${isSelected && COLORS.SELECTION_COLOR};
  `;

  return (
    <div
      tabIndex={0}
      css={containerStyle}
      onClick={onTabGroupClick}
      onKeyDown={(e) => handleKeyPress(e)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div css={leftStyle}>
        <NormalLabel
          style="max-width: 345px;"
          value={title}
          color={COLORS.TEXT_COLOR}
        />
        <NormalLabel
          value={`${windowCount} ${
            windowCount > 1 ? 'Windows' : 'Window'
          } - ${tabCount} ${tabCount > 1 ? 'Tabs' : 'Tab'}`}
          color={COLORS.LABEL_L1_COLOR}
          size="0.7rem"
          style="margin-top: 2px;"
        />
        {isAutoSave && <Tag value="AUTOSAVE" style="margin-top: 5px;" />}
        <div
          css={css`
            color: ${COLORS.LABEL_L2_COLOR};
            font-size: 0.625rem;
            margin-top: 5px;
          `}
        >
          {createdTime}
        </div>
      </div>
      <div css={rightStyle}>
        <Icon
          type="open_in_new"
          backgroundColor={
            isSelected ? COLORS.SELECTION_COLOR : COLORS.HOVER_COLOR
          }
          focusable={isHovered ? true : false}
          onClick={(e) => {
            e.stopPropagation();
            onOpenAllClick(e);
          }}
          style="padding: 22px 10px;"
        />
        <Icon
          type="delete"
          backgroundColor={
            isSelected ? COLORS.SELECTION_COLOR : COLORS.HOVER_COLOR
          }
          focusable={isHovered ? true : false}
          onClick={(e) => {
            e.stopPropagation();
            onDeleteClick(e);
          }}
          style="padding: 22px 10px;"
        />
      </div>
    </div>
  );
};

export default TabGroupEntry;
