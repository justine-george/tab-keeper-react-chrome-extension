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
    opacity: ${isParentHovered ? 1 : 0};
    transition: opacity 0.1s ease-out;
  `;

  const childrenContainerStyle = css`
    padding-left: 70px;
  `;

  const childrenStyle = css`
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
    max-width: 248px;
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
    max-width: 205px;
  `;

  function handleWindowTitleClick() {
    // TODO: open all the tabs in this context in a new window
  }

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
          <div
            onClick={handleWindowTitleClick}
            css={parentLinkStyle}
            tabIndex={0}
          >
            <NormalLabel
              value={title}
              color={COLORS.TEXT_COLOR}
              size="0.9rem"
              style="padding-left: 8px; cursor: pointer; height: 100%; max-width: 240px;"
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
                // key={tabId}
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
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    css={windowChildLinkStyle}
                  >
                    <NormalLabel
                      value={title}
                      color={COLORS.TEXT_COLOR}
                      size="0.9rem"
                      style="padding-left: 4px; cursor: pointer; height: 100%; max-width: 200px;"
                    />
                  </a>
                </div>
                <div css={childRightStyle(index)}>
                  <Icon
                    type="delete"
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
