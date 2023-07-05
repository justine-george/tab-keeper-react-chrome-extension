import { css } from "@emotion/react";
import Icon from "./Icon";
import { GLOBAL } from "../utils/Constants";
import { Tag } from "./Tag";

export default function HeroContainerRight() {
  const containerStyle = css`
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: space-between;
    border: 1px solid black;
    font-family: "Libre Franklin", sans-serif;
    user-select: none;
    background-color: ${GLOBAL.SECONDARY_COLOR};
  `;

  const topStyle = css`
    font-size: 1.125rem;
    padding: 8px;
    padding-bottom: unset;
  `;

  const bottomStyle = css`
    display: flex;
    padding-left: 8px;
    margin-bottom: 2px;
    margin-top: 8px;
    width: 100%;
    // justify-content: space-between;
    align-items: center;
  `;

  const title = "Youtube - Sample";
  const windowCount = 2;
  const tabCount = 5;
  const createdTime = "2023-06-23 13:02:03";
  const isAutoSave = true;

  return (
    <div css={containerStyle}>
      <div css={topStyle}>
        <div>{title}</div>
        <div
          css={css`
            color: #2d2d2d;
            font-size: 0.75rem;
            padding-top: 2px;
          `}
        >
          {windowCount} Windows - {tabCount} Tabs
        </div>
        <div
          css={css`
            color: #4a4a4a;
            font-size: 0.7rem;
            padding-top: 2px;
          `}
        >
          {createdTime}
        </div>
      </div>
      <div css={bottomStyle}>
        <div
          css={css`
            display: flex;
          `}
        >
          <Icon type="open_in_new" />
          <Icon type="delete" />
        </div>
        <div
          css={css`
            padding-left: 8px;
          `}
        >
          {isAutoSave && <Tag value="AUTOSAVE" style="padding: 4px 8px;" />}
        </div>
      </div>
    </div>
  );
}
