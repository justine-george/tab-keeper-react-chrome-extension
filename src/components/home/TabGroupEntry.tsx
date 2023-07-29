import React, { MouseEventHandler } from "react";
import { css } from "@emotion/react";
import Icon from "../common/Icon";
import { NormalLabel } from "../common/Label";
import { Tag } from "../common/Tag";
import { useThemeColors } from "../hook/useThemeColors";
import { tabContainerData } from "../../redux/slice/tabContainerDataStateSlice";

interface TabGroupEntryProps {
  tabGroupData: tabContainerData;
  onTabGroupClick: MouseEventHandler;
  onDeleteClick: MouseEventHandler;
}

const TabGroupEntry: React.FC<TabGroupEntryProps> = ({
  tabGroupData,
  onTabGroupClick,
  onDeleteClick,
}) => {
  const COLORS = useThemeColors();

  const { title, createdTime, isAutoSave, windowCount, tabCount, isSelected } =
    tabGroupData;

  function handleKeyPress(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter") {
      onTabGroupClick(e as any);
    }
  }

  const leftStyle = css`
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 8px;
    align-items: flex-start;
  `;

  const rightStyle = css`
    &.right-style-content {
      display: flex;
      flex-direction: row;
      height: 100%;
      justify-content: flex-start;
      align-items: flex-start;
      opacity: 0;
      transition: opacity 0.1s ease-out;
    }
  `;

  const containerStyle = css`
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: "Libre Franklin", sans-serif;
    cursor: pointer;
    transition: background-color 0.3s;
    &:hover {
      background-color: ${!isSelected && COLORS.HOVER_COLOR};
      .right-style-content {
        opacity: 1;
      }
    }
    background-color: ${isSelected && COLORS.SELECTION_COLOR};
    padding: 2px 0px;
  `;

  return (
    <div
      tabIndex={0}
      css={containerStyle}
      onClick={onTabGroupClick}
      onKeyDown={(e) => handleKeyPress(e)}
    >
      <div css={leftStyle}>
        <NormalLabel value={title} color={COLORS.TEXT_COLOR} />
        <NormalLabel
          value={`${windowCount} ${
            windowCount > 1 ? "Windows" : "Window"
          } - ${tabCount} ${tabCount > 1 ? "Tabs" : "Tab"}`}
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
      <div css={rightStyle} className="right-style-content">
        <Icon type="open_in_new" />
        <Icon
          type="delete"
          onClick={(e) => {
            e.stopPropagation();
            onDeleteClick(e);
          }}
        />
      </div>
    </div>
  );
};

export default TabGroupEntry;
