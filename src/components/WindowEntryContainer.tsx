import React from "react";
import { css } from "@emotion/react";
import Icon from "./Icon";
import { NormalLabel } from "./Label";
import { GLOBAL } from "../utils/constants";

interface WindowEntryContainerProps {
  title: string;
  tabs: Array<{
    title: string;
    favicon: string;
  }>;
}

const WindowEntryContainer: React.FC<WindowEntryContainerProps> = ({
  title,
  tabs,
}) => {
  const containerStyle = css`
    display: flex;
    flex-direction: column;
    font-family: "Libre Franklin", sans-serif;
    margin-bottom: 8px;
  `;

  const parentStyle = css`
    display: flex;
    justify-content: space-between;
    transition: background-color 0.3s;
    &:hover {
      background-color: ${GLOBAL.HOVER_COLOR};
    }
  `;

  const childrenStyle = css`
    padding-left: 70px;
  `;

  return (
    <div css={containerStyle}>
      <div css={parentStyle}>
        <div
          css={css`
            display: flex;
            align-items: center;
          `}
        >
          <Icon type="expand_more" />
          <Icon type="ad" style="cursor: auto;" />
          <NormalLabel
            value={title}
            color="black"
            size="0.9rem"
            style="padding-left: 8px; cursor: pointer;"
          />
        </div>
        <div
          css={css`
            // display: none;
            // &:hover {
            //   display: block;
            }
          `}
        >
          <Icon type="delete" />
        </div>
      </div>
      <div css={childrenStyle}>
        {tabs.map(({ title, favicon }, index) => {
          return (
            <div
              css={css`
                display: flex;
                align-items: center;
                justify-content: space-between;
                transition: background-color 0.3s;
                &:hover {
                  background-color: ${GLOBAL.HOVER_COLOR};
                }
                // border: 1px solid black;
              `}
            >
              <div
                css={css`
                  display: flex;
                  align-items: center;
                `}
              >
                <Icon type="app_badging" />
                <NormalLabel
                  value={title}
                  color="black"
                  size="0.9rem"
                  style="padding-left: 8px; cursor: pointer;"
                />
              </div>
              <div
                css={css`
                  // display: none;
                  // &:hover {
                  //   display: block;
                  }
                `}
              >
                <Icon type="delete" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default WindowEntryContainer;
