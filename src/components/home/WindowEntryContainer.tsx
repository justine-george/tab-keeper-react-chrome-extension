import React, { MouseEventHandler, useEffect, useState } from "react";
import { css } from "@emotion/react";
import Icon from "../common/Icon";
import { NormalLabel } from "../common/Label";
import { useThemeColors } from "../hook/useThemeColors";
import { nonInteractIconStyle } from "../../utils/constants";
import { useDispatch } from "react-redux";
import {
  deleteTab,
  tabData,
} from "../../redux/slice/tabContainerDataStateSlice";

interface WindowEntryContainerProps {
  title: string;
  tabs: tabData[];
  tabGroupId: string;
  windowId: string;
  onDeleteClick: MouseEventHandler;
}

const WindowEntryContainer: React.FC<WindowEntryContainerProps> = ({
  title,
  tabs,
  tabGroupId,
  windowId,
  onDeleteClick,
}) => {
  const COLORS = useThemeColors();

  const dispatch = useDispatch();

  const [windowOpenState, setWindowOpenState] = useState(true);

  function handleAccordionClick() {
    setWindowOpenState((state) => !state);
  }

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
      .parent-right-style-content {
        opacity: 1;
      }
    }
  `;

  const parentRightStyle = css`
    &.parent-right-style-content {
      opacity: 0;
      transition: opacity 0.1s ease-out;
    }
  `;

  const childrenContainerStyle = css`
    padding-left: 70px;
  `;

  const childrenStyle = css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    transition: background-color 0.3s;
    &:hover {
      background-color: ${COLORS.HOVER_COLOR};
      .child-right-style-content {
        opacity: 1;
      }
    }
  `;

  const childRightStyle = css`
    &.child-right-style-content {
      opacity: 0;
      transition: opacity 0.1s ease-out;
    }
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
          <Icon
            type={windowOpenState ? "expand_less" : "expand_more"}
            onClick={handleAccordionClick}
          />
          <Icon type="ad" style={nonInteractIconStyle} />
          <NormalLabel
            value={title}
            color={COLORS.TEXT_COLOR}
            size="0.9rem"
            style="padding-left: 8px; cursor: pointer;"
          />
        </div>
        <div css={parentRightStyle} className="parent-right-style-content">
          <Icon
            type="delete"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteClick(e);
            }}
          />
        </div>
      </div>
      {windowOpenState && (
        <div css={childrenContainerStyle}>
          {tabs.map(({ tabId, favicon, title, url }, _) => {
            return (
              <div
                // key={tabId}
                css={childrenStyle}
              >
                <div
                  css={css`
                    display: flex;
                    align-items: center;
                  `}
                >
                  <Icon
                    faviconUrl={favicon}
                    type="app_badging"
                    style={nonInteractIconStyle}
                  />
                  <a
                    href={url}
                    target="_blank"
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <NormalLabel
                      value={title}
                      color={COLORS.TEXT_COLOR}
                      size="0.9rem"
                      style="padding-left: 8px; cursor: pointer;"
                    />
                  </a>
                </div>
                <div
                  css={childRightStyle}
                  className="child-right-style-content"
                >
                  <Icon
                    type="delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch(deleteTab({ tabGroupId, windowId, tabId }));
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default WindowEntryContainer;
