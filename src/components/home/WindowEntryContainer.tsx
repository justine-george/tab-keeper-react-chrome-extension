import React, { MouseEventHandler, useEffect, useState } from 'react';
import { css } from '@emotion/react';
import Icon from '../common/Icon';
import { NormalLabel } from '../common/Label';
import { useThemeColors } from '../hook/useThemeColors';
import { NON_INTERACTIVE_ICON_STYLE } from '../../utils/constants/common';
import { useDispatch } from 'react-redux';
import {
  deleteTab,
  tabData,
} from '../../redux/slice/tabContainerDataStateSlice';
import { AppDispatch } from '../../redux/store';

interface WindowEntryContainerProps {
  title: string;
  tabs: tabData[];
  tabGroupId: string;
  windowId: string;
  onWindowTitleClick: MouseEventHandler;
  onDeleteClick: MouseEventHandler;
}

const WindowEntryContainer: React.FC<WindowEntryContainerProps> = ({
  title,
  tabs,
  tabGroupId,
  windowId,
  onWindowTitleClick,
  onDeleteClick,
}) => {
  const COLORS = useThemeColors();

  const dispatch: AppDispatch = useDispatch();

  const [windowOpenState, setWindowOpenState] = useState(true);

  const [isParentHovered, setIsParentHovered] = useState(false);
  const [hoveredChildIndex, setHoveredChildIndex] = useState<number | null>(
    null
  );

  // reset the 'windowOpenState' to true whenever a different tabGroup is selected.
  useEffect(() => {
    setWindowOpenState(true);
  }, [tabGroupId]);

  function handleAccordionClick() {
    setWindowOpenState((state) => !state);
  }

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    font-family: 'Libre Franklin', sans-serif;
    margin-bottom: 8px;
  `;

  const parentStyle = css`
    position: relative;
    display: flex;
    justify-content: space-between;
    transition: background-color 0.3s;
    &:hover {
      background-color: ${COLORS.HOVER_COLOR};
    }
  `;

  const parentLeftStyle = css`
    display: flex;
    align-items: center;
    flex-grow: 1;
  `;

  const parentRightStyle = css`
    position: absolute;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
    opacity: ${isParentHovered ? 1 : 0};
    transition: opacity 0.1s ease-out;
  `;

  const childrenContainerStyle = css`
    padding-left: 70px;
  `;

  const childrenStyle = css`
    position: relative;
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    transition: background-color 0.3s;
    &:hover {
      background-color: ${COLORS.HOVER_COLOR};
    }
  `;

  const childLeftStyle = css`
    display: flex;
    align-items: center;
    flex-grow: 1;
  `;

  const childRightStyle = (index: number) => css`
    position: absolute;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
    opacity: ${hoveredChildIndex === index ? 1 : 0};
    transition: opacity 0.1s ease-out;
  `;

  const parentLinkStyle = css`
    text-decoration: none;
    color: inherit;
    display: flex;
    align-items: center;
    height: 100%;
    flex-grow: 1;
    padding-right: 9px;
    cursor: pointer;
  `;

  const windowChildLinkStyle = css`
    text-decoration: none;
    color: inherit;
    display: flex;
    align-items: center;
    height: 100%;
    flex-grow: 1;
    margin-left: 4px;
    margin-right: 4px;
  `;

  const handleTabClick = (url: string) => {
    chrome.tabs.create({ url: url });
  };

  return (
    <div css={containerStyle}>
      <div
        css={parentStyle}
        onMouseEnter={() => setIsParentHovered(true)}
        onMouseLeave={() => setIsParentHovered(false)}
      >
        <div css={parentLeftStyle}>
          <Icon
            type={windowOpenState ? 'expand_less' : 'expand_more'}
            onClick={handleAccordionClick}
          />
          <Icon type="ad" style={NON_INTERACTIVE_ICON_STYLE} />
          <div css={parentLinkStyle} tabIndex={0}>
            <NormalLabel
              value={title}
              color={COLORS.TEXT_COLOR}
              size="0.9rem"
              style="padding-left: 8px; cursor: pointer; height: 100%; max-width: 285px;"
              onClick={(e) => {
                e.stopPropagation();
                onWindowTitleClick(e);
              }}
            />
          </div>
        </div>
        <div css={parentRightStyle}>
          <Icon
            type="delete"
            backgroundColor={COLORS.HOVER_COLOR}
            onClick={(e) => {
              e.stopPropagation();
              onDeleteClick(e);
            }}
            focusable={isParentHovered}
          />
        </div>
      </div>
      {windowOpenState && (
        <div css={childrenContainerStyle}>
          {tabs.map(({ tabId, favicon, title, url }, index) => {
            return (
              <div
                css={childrenStyle}
                onMouseEnter={() => setHoveredChildIndex(index)}
                onMouseLeave={() => setHoveredChildIndex(null)}
              >
                <div css={childLeftStyle}>
                  <Icon
                    faviconUrl={favicon}
                    type="app_badging"
                    style={NON_INTERACTIVE_ICON_STYLE}
                  />
                  <div
                    css={windowChildLinkStyle}
                    onClick={() => handleTabClick(url)}
                  >
                    <NormalLabel
                      value={title}
                      color={COLORS.TEXT_COLOR}
                      size="0.9rem"
                      style="padding-left: 4px; cursor: pointer; height: 100%; max-width: 245px;"
                    />
                  </div>
                </div>
                <div css={childRightStyle(index)}>
                  <Icon
                    type="delete"
                    backgroundColor={COLORS.HOVER_COLOR}
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch(deleteTab({ tabGroupId, windowId, tabId }));
                    }}
                    focusable={hoveredChildIndex === index}
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
