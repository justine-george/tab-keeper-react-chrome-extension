import React from "react";
import { css } from "@emotion/react";
import Icon from "./Icon";
import { GLOBAL } from "../utils/Constants";
import { NormalLabel } from "./Label";
import { Tag } from "./Tag";

interface TabGroupEntryProps {
  title: string;
  windowCount: number;
  tabCount: number;
  createdTime: string;
  isAutoSave: boolean;
  isSelected: boolean;
}

const TabGroupEntry: React.FC<TabGroupEntryProps> = ({
  title,
  windowCount,
  tabCount,
  createdTime,
  isAutoSave,
  isSelected,
}) => {
  const containerStyle = css`
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: "Libre Franklin", sans-serif;
    cursor: pointer;
    transition: background-color 0.3s;
    &:hover {
      background-color: ${!isSelected && GLOBAL.HOVER_COLOR};
    }
    background-color: ${isSelected && GLOBAL.SELECTION_COLOR};
    padding: 2px 0px;
  `;

  const leftStyle = css`
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 8px;
    align-items: flex-start;
  `;

  const rightStyle = css`
    display: flex;
    flex-direction: row;
    height: 100%;
    justify-content: flex-start;
    align-items: flex-start;
  `;

  return (
    <div css={containerStyle}>
      <div css={leftStyle}>
        <NormalLabel value={title} color="black" />
        <NormalLabel
          value={`${windowCount} Windows - ${tabCount} Tabs`}
          color="#2d2d2d"
          size="0.7rem"
          style="margin-top: 2px;"
        />
        {isAutoSave && <Tag value="AUTOSAVE" style="margin-top: 5px;" />}
        <div
          css={css`
            color: #4a4a4a;
            font-size: 0.625rem;
            margin-top: 5px;
          `}
        >
          {createdTime}
        </div>
      </div>
      <div css={rightStyle}>
        <Icon type="open_in_new" />
        <Icon type="delete" />
      </div>
    </div>
  );
};

export default TabGroupEntry;
