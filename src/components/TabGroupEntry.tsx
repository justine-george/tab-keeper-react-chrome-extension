import React from "react";
import { css } from "@emotion/react";
import Icon from "./Icon";

interface TabGroupEntryProps {
  title: string;
  windowCount: number;
  tabCount: number;
  createdTime: string;
  isAutoSave: boolean;
}

const TabGroupEntry: React.FC<TabGroupEntryProps> = ({
  title,
  windowCount,
  tabCount,
  createdTime,
  isAutoSave,
}) => {
  const containerStyle = css`
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: "Libre Franklin", sans-serif;
    cursor: pointer;
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
        <div>{title}</div>
        <div
          css={css`
            color: #2d2d2d;
            font-size: 0.7rem;
            margin-top: 2px;
          `}
        >
          {windowCount} Windows - {tabCount} Tabs
        </div>
        {isAutoSave && (
          <div
            css={css`
              background-color: #d3d3d3;
              border: 1px solid #c0c0c0;
              font-size: 0.7rem;
              padding: 2px 5px;
              margin-top: 5px;
            `}
          >
            AUTOSAVE
          </div>
        )}
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
