import React from "react";
import { css } from "@emotion/react";
import Icon from "../common/Icon";
import { NormalLabel } from "../common/Label";
import { useThemeColors } from "../hook/useThemeColors";
import { nonInteractIconStyle } from "../../utils/constants";

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
  const COLORS = useThemeColors();

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
      background-color: ${COLORS.HOVER_COLOR};
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
          <Icon type="ad" style={nonInteractIconStyle} />
          <NormalLabel
            value={title}
            color={COLORS.TEXT_COLOR}
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
                  background-color: ${COLORS.HOVER_COLOR};
                }
              `}
            >
              <div
                css={css`
                  display: flex;
                  align-items: center;
                `}
              >
                <Icon type="app_badging" style={nonInteractIconStyle} />
                <NormalLabel
                  value={title}
                  color={COLORS.TEXT_COLOR}
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
